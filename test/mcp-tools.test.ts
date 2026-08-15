import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contextCommit, contextDiff, contextMerge, contextSearch } from '../src/mcp/tools.js';
import { createBranch, headCheckpoint, readFacts } from '../src/versioning/branches.js';
import { setActiveBranch } from '../src/versioning/active.js';
import { recordCheckpoint } from '../src/versioning/checkpoint.js';
import { readObject } from '../src/versioning/objects.js';

describe('mcp/tools', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-mcp-tools-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('contextSearch', () => {
    it('errors when no branch is active and none is specified', () => {
      const result = contextSearch({});
      expect(result).toEqual({ error: expect.stringContaining('no active branch') });
    });

    it('errors for a branch with no brg context', () => {
      const result = contextSearch({ branch: 'does-not-exist' });
      expect(result).toEqual({ error: expect.stringContaining('does-not-exist') });
    });

    it('defaults to the active branch and returns intent/summary/facts/recent checkpoints', () => {
      createBranch('main', 'Explore payments');
      setActiveBranch('main');
      recordCheckpoint('main', 'claude', 'added stripe', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ], 'manual');

      const result = contextSearch({});
      expect(result).toMatchObject({
        branch: 'main',
        intent: 'Explore payments',
        facts: [{ subject: 'payments', relation: 'provider', object: 'stripe' }],
      });
      expect('recentCheckpoints' in result && result.recentCheckpoints).toHaveLength(1);
    });

    it('an explicit branch overrides the active one', () => {
      createBranch('main', 'root');
      createBranch('feature', 'a feature');
      setActiveBranch('main');
      recordCheckpoint('feature', 'claude', 'feature work', [
        { op: 'add', subject: 'x', relation: 'y', object: 'z' },
      ], 'manual');

      const result = contextSearch({ branch: 'feature' });
      expect(result).toMatchObject({ branch: 'feature' });
    });

    it('query filters facts by substring match across subject/relation/object', () => {
      createBranch('main', 'root');
      setActiveBranch('main');
      recordCheckpoint('main', 'claude', 'work', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
        { op: 'add', subject: 'auth', relation: 'method', object: 'oauth' },
      ], 'manual');

      const result = contextSearch({ query: 'stripe' });
      expect('facts' in result && result.facts).toEqual([
        { subject: 'payments', relation: 'provider', object: 'stripe' },
      ]);
    });

    it('an empty query returns all facts, same as no query', () => {
      createBranch('main', 'root');
      setActiveBranch('main');
      recordCheckpoint('main', 'claude', 'work', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ], 'manual');

      const result = contextSearch({ query: '' });
      expect('facts' in result && result.facts).toHaveLength(1);
    });
  });

  describe('contextCommit', () => {
    it('errors when no branch is active and none is specified', () => {
      expect(contextCommit({ message: 'hi' })).toEqual({ error: expect.stringContaining('no active branch') });
    });

    it('records a checkpoint on the active branch and returns its id', () => {
      createBranch('main', 'root');
      setActiveBranch('main');

      const result = contextCommit({ message: 'did the thing', tool: 'codex' });
      expect(result).toMatchObject({ branch: 'main' });
      const id = 'checkpointId' in result ? result.checkpointId : undefined;
      expect(id).toBeDefined();
      expect(readObject(id!)).toMatchObject({ tool: 'codex', message: 'did the thing', facts_delta: [] });
    });

    it('respects an explicit branch override', () => {
      createBranch('main', 'root');
      createBranch('feature', 'a feature');
      setActiveBranch('main');

      contextCommit({ message: 'feature work', branch: 'feature' });

      expect(headCheckpoint('feature')).not.toBeNull();
      expect(headCheckpoint('main')).toBeNull();
    });

    it('records facts pushed directly by the calling agent, with source "mcp-agent"', () => {
      createBranch('main', 'root');
      setActiveBranch('main');

      const result = contextCommit({
        message: 'chose stripe',
        facts: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      });

      const id = 'checkpointId' in result ? result.checkpointId : undefined;
      expect(readObject(id!)).toMatchObject({
        source: 'mcp-agent',
        facts_delta: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      });
      expect(readFacts('main')).toHaveLength(1);
    });

    it('uses source "manual" when no facts are pushed, same as before', () => {
      createBranch('main', 'root');
      setActiveBranch('main');

      const result = contextCommit({ message: 'just a note' });

      const id = 'checkpointId' in result ? result.checkpointId : undefined;
      expect(readObject(id!)).toMatchObject({ source: 'manual', facts_delta: [] });
    });

    it('an empty facts array also uses source "manual", not "mcp-agent"', () => {
      createBranch('main', 'root');
      setActiveBranch('main');

      const result = contextCommit({ message: 'just a note', facts: [] });

      const id = 'checkpointId' in result ? result.checkpointId : undefined;
      expect(readObject(id!)?.source).toBe('manual');
    });
  });

  describe('contextDiff', () => {
    it('errors when a branch has no brg context', () => {
      createBranch('main', 'root');
      expect(contextDiff({ branchA: 'main', branchB: 'ghost' })).toEqual({
        error: expect.stringContaining('ghost'),
      });
    });

    it('returns structural differences between two branches', () => {
      createBranch('main', 'root');
      createBranch('feature', 'a feature');
      recordCheckpoint('main', 'claude', 'm', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ], 'manual');
      recordCheckpoint('feature', 'claude', 'f', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' },
      ], 'manual');

      const result = contextDiff({ branchA: 'main', branchB: 'feature' });
      expect(result).toMatchObject({
        branchA: 'main',
        branchB: 'feature',
        differences: [{ kind: 'changed', subject: 'payments', relation: 'provider', from: ['stripe'], to: ['razorpay'] }],
      });
    });
  });

  describe('contextMerge', () => {
    it('errors when no target is active and none is specified', () => {
      createBranch('feature', 'a feature');
      recordCheckpoint('feature', 'claude', 'f', [], 'manual');
      expect(contextMerge({ source: 'feature' })).toEqual({ error: expect.stringContaining('no active branch') });
    });

    it('errors when source has no brg context', () => {
      createBranch('main', 'root');
      setActiveBranch('main');
      recordCheckpoint('main', 'claude', 'm', [], 'manual');
      expect(contextMerge({ source: 'ghost' })).toEqual({ error: expect.stringContaining('ghost') });
    });

    it('errors when merging a branch into itself', () => {
      createBranch('main', 'root');
      setActiveBranch('main');
      recordCheckpoint('main', 'claude', 'm', [], 'manual');
      expect(contextMerge({ source: 'main' })).toEqual({ error: expect.stringContaining('itself') });
    });

    it('errors when either branch has no checkpoints yet', () => {
      createBranch('main', 'root');
      createBranch('feature', 'a feature');
      setActiveBranch('main');
      expect(contextMerge({ source: 'feature' })).toEqual({ error: expect.stringContaining('checkpoint') });
    });

    it('merges cleanly and commits when there is no conflict', () => {
      createBranch('main', 'root');
      createBranch('feature', 'a feature');
      setActiveBranch('main');
      recordCheckpoint('main', 'claude', 'm', [
        { op: 'add', subject: 'auth', relation: 'method', object: 'oauth' },
      ], 'manual');
      recordCheckpoint('feature', 'claude', 'f', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ], 'manual');

      const result = contextMerge({ source: 'feature' });
      expect(result).toMatchObject({ status: 'merged', target: 'main' });
      expect(readFacts('main').map((f) => f.object).sort()).toEqual(['oauth', 'stripe']);
    });

    it('a real conflict is returned as data, not committed', () => {
      createBranch('main', 'root');
      createBranch('feature', 'a feature');
      setActiveBranch('main');
      recordCheckpoint('main', 'claude', 'm', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ], 'manual');
      recordCheckpoint('feature', 'claude', 'f', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' },
      ], 'manual');

      const result = contextMerge({ source: 'feature' });
      expect(result).toEqual({
        status: 'conflicts',
        conflicts: [{ subject: 'payments', relation: 'provider', target: ['stripe'], source: ['razorpay'] }],
      });
      // Not committed: main's own head checkpoint is still the last real one.
      expect(readFacts('main')).toEqual([
        expect.objectContaining({ subject: 'payments', relation: 'provider', object: 'stripe' }),
      ]);
    });

    it('a second call with resolutions finishes a previously-conflicted merge', () => {
      createBranch('main', 'root');
      createBranch('feature', 'a feature');
      setActiveBranch('main');
      recordCheckpoint('main', 'claude', 'm', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ], 'manual');
      recordCheckpoint('feature', 'claude', 'f', [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' },
      ], 'manual');

      const result = contextMerge({
        source: 'feature',
        resolutions: [{ subject: 'payments', relation: 'provider', choice: 'source' }],
      });

      expect(result).toMatchObject({ status: 'merged' });
      expect(readFacts('main').map((f) => f.object)).toEqual(['razorpay']);
    });

    it('an explicit target overrides the active branch', () => {
      createBranch('main', 'root');
      createBranch('other', 'other target');
      createBranch('feature', 'a feature');
      setActiveBranch('main');
      recordCheckpoint('other', 'claude', 'o', [], 'manual');
      recordCheckpoint('feature', 'claude', 'f', [
        { op: 'add', subject: 'x', relation: 'y', object: 'z' },
      ], 'manual');

      const result = contextMerge({ source: 'feature', target: 'other' });
      expect(result).toMatchObject({ status: 'merged', target: 'other' });
      expect(readFacts('main')).toEqual([]);
    });
  });
});

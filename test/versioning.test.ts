import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeCheckpointId, readObject, writeObject } from '../src/versioning/objects.js';
import { applyFactsDelta } from '../src/versioning/facts.js';
import {
  appendLogEntry,
  branchExists,
  createBranch,
  headCheckpoint,
  listBranches,
  readFacts,
  readIntent,
  readLog,
  writeFacts,
} from '../src/versioning/branches.js';
import { getMapping, setMapping } from '../src/versioning/gitmap.js';
import { recordCheckpoint } from '../src/versioning/checkpoint.js';
import type { CheckpointObjectInput } from '../src/versioning/types.js';

describe('versioning/objects', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-versioning-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseInput = (): CheckpointObjectInput => ({
    parent: null,
    branch: 'main',
    tool: 'claude',
    timestamp: '2026-08-15T10:22:00Z',
    message: 'chose Stripe over Razorpay for webhooks',
    facts_delta: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
    source: 'manual',
  });

  it('identical checkpoints hash identically (dedup)', () => {
    const a = computeCheckpointId(baseInput());
    const b = computeCheckpointId(baseInput());
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
  });

  it('key order does not affect the hash', () => {
    const input = baseInput();
    const reordered = {
      source: input.source,
      facts_delta: input.facts_delta,
      message: input.message,
      timestamp: input.timestamp,
      tool: input.tool,
      branch: input.branch,
      parent: input.parent,
    } as CheckpointObjectInput;
    expect(computeCheckpointId(input)).toBe(computeCheckpointId(reordered));
  });

  it('a different message changes the hash', () => {
    const a = computeCheckpointId(baseInput());
    const b = computeCheckpointId({ ...baseInput(), message: 'something else' });
    expect(a).not.toBe(b);
  });

  it('writes and reads an object back by id', () => {
    const written = writeObject(baseInput());
    const read = readObject(written.id);
    expect(read).toEqual(written);
  });

  it('reading a missing object returns null instead of throwing', () => {
    expect(readObject('sha256:doesnotexist')).toBeNull();
  });

  it('writing the same object twice does not error and yields the same id', () => {
    const first = writeObject(baseInput());
    const second = writeObject(baseInput());
    expect(second.id).toBe(first.id);
  });
});

describe('versioning/facts', () => {
  it('add inserts a fact tagged with the checkpoint id', () => {
    const result = applyFactsDelta(
      [],
      [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      'sha256:abc',
    );
    expect(result).toEqual([
      { subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: 'sha256:abc', confidence: 'stated' },
    ]);
  });

  it('add replaces an existing identical triple rather than duplicating it', () => {
    const existing = applyFactsDelta(
      [],
      [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      'sha256:abc',
    );
    const result = applyFactsDelta(
      existing,
      [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      'sha256:def',
    );
    expect(result).toHaveLength(1);
    expect(result[0].checkpoint).toBe('sha256:def');
  });

  it('remove drops a matching fact', () => {
    const existing = applyFactsDelta(
      [],
      [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      'sha256:abc',
    );
    const result = applyFactsDelta(
      existing,
      [{ op: 'remove', subject: 'payments', relation: 'provider', object: 'stripe' }],
      'sha256:def',
    );
    expect(result).toEqual([]);
  });

  it('remove of a non-existent fact is a no-op, not an error', () => {
    const result = applyFactsDelta(
      [],
      [{ op: 'remove', subject: 'payments', relation: 'provider', object: 'stripe' }],
      'sha256:abc',
    );
    expect(result).toEqual([]);
  });
});

describe('versioning/branches', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-branches-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createBranch sets up intent/summary/facts/log and is detectable via branchExists', () => {
    createBranch('feature-payments', 'Add Stripe support');
    expect(branchExists('feature-payments')).toBe(true);
    expect(readIntent('feature-payments')).toBe('Add Stripe support\n');
    expect(readFacts('feature-payments')).toEqual([]);
    expect(readLog('feature-payments')).toEqual([]);
    expect(listBranches()).toEqual(['feature-payments']);
  });

  it('createBranch throws rather than clobbering an existing branch', () => {
    createBranch('feature-payments', 'Add Stripe support');
    expect(() => createBranch('feature-payments', 'different intent')).toThrow();
  });

  it('log is append-only, oldest first, and headCheckpoint returns the last entry', () => {
    createBranch('main', 'root');
    appendLogEntry('main', 'sha256:aaa');
    appendLogEntry('main', 'sha256:bbb');
    expect(readLog('main')).toEqual(['sha256:aaa', 'sha256:bbb']);
    expect(headCheckpoint('main')).toBe('sha256:bbb');
  });

  it('headCheckpoint is null for a branch with no checkpoints', () => {
    createBranch('main', 'root');
    expect(headCheckpoint('main')).toBeNull();
  });

  it('writeFacts/readFacts round-trip', () => {
    createBranch('main', 'root');
    const facts = [
      { subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: 'sha256:aaa', confidence: 'stated' },
    ];
    writeFacts('main', facts);
    expect(readFacts('main')).toEqual(facts);
  });
});

describe('versioning/gitmap', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-gitmap-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined for an unmapped branch', () => {
    expect(getMapping('feature-payments')).toBeUndefined();
  });

  it('setMapping/getMapping round-trip', () => {
    setMapping('feature-payments', { git_branch: 'feature-payments', created_from_sha: '1d0e88' });
    expect(getMapping('feature-payments')).toEqual({
      git_branch: 'feature-payments',
      created_from_sha: '1d0e88',
    });
  });
});

describe('versioning/checkpoint', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-record-checkpoint-'));
    process.chdir(tmpDir);
    createBranch('main', 'root');
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records an object, updates facts.json, and appends the log in one call', async () => {
    const checkpoint = recordCheckpoint(
      'main',
      'claude',
      'chose Stripe over Razorpay for webhooks',
      [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      'manual',
    );

    expect(checkpoint.parent).toBeNull();
    expect(readObject(checkpoint.id)).toEqual(checkpoint);
    expect(readFacts('main')).toEqual([
      { subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: checkpoint.id, confidence: 'stated' },
    ]);
    expect(readLog('main')).toEqual([checkpoint.id]);
  });

  it('a second checkpoint is parented to the first', async () => {
    const first = recordCheckpoint('main', 'claude', 'first', [], 'manual');
    const second = recordCheckpoint('main', 'claude', 'second', [], 'manual');
    expect(second.parent).toBe(first.id);
    expect(readLog('main')).toEqual([first.id, second.id]);
  });

  it('does not touch Phase 1 files (context.md, sessions/)', async () => {
    recordCheckpoint('main', 'claude', 'first', [], 'manual');
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'context.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'sessions'))).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyConflictChoice, mergeFacts } from '../src/versioning/merge.js';
import { computeFactsDelta } from '../src/versioning/facts.js';
import { createBranch, readFacts, readLog } from '../src/versioning/branches.js';
import { recordCheckpoint, recordMergeCheckpoint } from '../src/versioning/checkpoint.js';
import { readObject } from '../src/versioning/objects.js';
import { mergeCommand } from '../src/commands/merge.js';
import type { Fact } from '../src/versioning/types.js';

const fact = (subject: string, relation: string, object: string, checkpoint = 'sha256:x'): Fact => ({
  subject,
  relation,
  object,
  checkpoint,
  confidence: 'stated',
});

describe('versioning/merge — mergeFacts', () => {
  it('unions facts unique to one side with no conflict', () => {
    const result = mergeFacts([fact('auth', 'method', 'oauth')], [fact('db', 'engine', 'postgres')]);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toHaveLength(2);
  });

  it('dedups an identical fact present on both sides', () => {
    const shared = fact('payments', 'provider', 'stripe');
    const result = mergeFacts([shared], [shared]);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toHaveLength(1);
  });

  it('flags differing objects for the same (subject, relation) as a conflict, not a silent overwrite', () => {
    const result = mergeFacts(
      [fact('payments', 'provider', 'stripe')],
      [fact('payments', 'provider', 'razorpay')],
    );
    expect(result.merged).toEqual([]);
    expect(result.conflicts).toEqual([
      {
        subject: 'payments',
        relation: 'provider',
        targetFacts: [fact('payments', 'provider', 'stripe')],
        sourceFacts: [fact('payments', 'provider', 'razorpay')],
      },
    ]);
  });

  it('both empty fact sets merge to empty with no conflicts', () => {
    expect(mergeFacts([], [])).toEqual({ merged: [], conflicts: [] });
  });

  it('a fact only in target (branch has more facts than source) merges automatically, is not a conflict', () => {
    const result = mergeFacts([fact('legacy', 'flag', 'true')], []);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual([fact('legacy', 'flag', 'true')]);
  });

  it('applyConflictChoice "target" keeps only target facts', () => {
    const conflict = {
      subject: 'payments',
      relation: 'provider',
      targetFacts: [fact('payments', 'provider', 'stripe')],
      sourceFacts: [fact('payments', 'provider', 'razorpay')],
    };
    expect(applyConflictChoice('target', conflict)).toEqual(conflict.targetFacts);
  });

  it('applyConflictChoice "source" keeps only source facts', () => {
    const conflict = {
      subject: 'payments',
      relation: 'provider',
      targetFacts: [fact('payments', 'provider', 'stripe')],
      sourceFacts: [fact('payments', 'provider', 'razorpay')],
    };
    expect(applyConflictChoice('source', conflict)).toEqual(conflict.sourceFacts);
  });

  it('applyConflictChoice "both" keeps every fact from both sides', () => {
    const conflict = {
      subject: 'payments',
      relation: 'provider',
      targetFacts: [fact('payments', 'provider', 'stripe')],
      sourceFacts: [fact('payments', 'provider', 'razorpay')],
    };
    expect(applyConflictChoice('both', conflict)).toHaveLength(2);
  });
});

describe('versioning/facts — computeFactsDelta', () => {
  it('empty to non-empty produces only add ops', () => {
    const delta = computeFactsDelta([], [fact('payments', 'provider', 'stripe')]);
    expect(delta).toEqual([{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }]);
  });

  it('non-empty to empty produces only remove ops', () => {
    const delta = computeFactsDelta([fact('payments', 'provider', 'stripe')], []);
    expect(delta).toEqual([{ op: 'remove', subject: 'payments', relation: 'provider', object: 'stripe' }]);
  });

  it('identical fact sets produce no ops', () => {
    const facts = [fact('payments', 'provider', 'stripe')];
    expect(computeFactsDelta(facts, facts)).toEqual([]);
  });

  it('a swapped object produces one remove and one add', () => {
    const delta = computeFactsDelta(
      [fact('payments', 'provider', 'stripe')],
      [fact('payments', 'provider', 'razorpay')],
    );
    expect(delta).toEqual([
      { op: 'remove', subject: 'payments', relation: 'provider', object: 'stripe' },
      { op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' },
    ]);
  });
});

describe('versioning/checkpoint — recordMergeCheckpoint', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-merge-checkpoint-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws if either branch has no checkpoints yet', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    expect(() => recordMergeCheckpoint('main', 'feature', 'claude', 'merge', [])).toThrow();
  });

  it('writes a two-parent checkpoint and updates target facts/log', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    const mainFirst = recordCheckpoint('main', 'claude', 'main work', [
      { op: 'add', subject: 'auth', relation: 'method', object: 'oauth' },
    ], 'manual');
    const featureFirst = recordCheckpoint('feature', 'claude', 'feature work', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');

    const merged = [
      fact('auth', 'method', 'oauth', mainFirst.id),
      fact('payments', 'provider', 'stripe', featureFirst.id),
    ];
    const mergeCheckpoint = recordMergeCheckpoint('main', 'feature', 'claude', 'merged feature', merged);

    expect(mergeCheckpoint.parent).toBeNull();
    expect(mergeCheckpoint.parents).toEqual([mainFirst.id, featureFirst.id]);
    expect(readFacts('main')).toEqual(merged);
    expect(readLog('main')).toEqual([mainFirst.id, mergeCheckpoint.id]);
    expect(readObject(mergeCheckpoint.id)).toEqual(mergeCheckpoint);
  });

  it('facts_delta on the merge checkpoint reflects only what changed on target', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'main work', [
      { op: 'add', subject: 'auth', relation: 'method', object: 'oauth' },
    ], 'manual');
    recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

    const merged = [
      fact('auth', 'method', 'oauth'),
      fact('payments', 'provider', 'stripe'),
    ];
    const mergeCheckpoint = recordMergeCheckpoint('main', 'feature', 'claude', 'merged feature', merged);

    expect(mergeCheckpoint.facts_delta).toEqual([
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ]);
  });
});

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: dir });
}

describe('brg merge command', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-merge-cmd-'));
    process.chdir(tmpDir);
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('errors when the current git branch has no brg context', async () => {
    await mergeCommand('feature', {});
    expect(process.exitCode).toBe(1);
  });

  it('errors when the source branch has no brg context', async () => {
    createBranch('main', 'root');
    recordCheckpoint('main', 'claude', 'work', [], 'manual');
    await mergeCommand('does-not-exist', {});
    expect(process.exitCode).toBe(1);
  });

  it('errors when merging a branch into itself', async () => {
    createBranch('main', 'root');
    recordCheckpoint('main', 'claude', 'work', [], 'manual');
    await mergeCommand('main', {});
    expect(process.exitCode).toBe(1);
  });

  it('errors when either branch has no checkpoints yet', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    await mergeCommand('feature', {});
    expect(process.exitCode).toBe(1);
  });

  it('merges cleanly with no conflicts and never calls the conflict resolver', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'main work', [
      { op: 'add', subject: 'auth', relation: 'method', object: 'oauth' },
    ], 'manual');
    recordCheckpoint('feature', 'claude', 'feature work', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');

    let resolverCalled = false;
    await mergeCommand('feature', {}, { resolveConflict: async () => { resolverCalled = true; return 'both'; } });

    expect(process.exitCode ?? 0).toBe(0);
    expect(resolverCalled).toBe(false);
    const facts = readFacts('main');
    expect(facts.map((f) => f.object).sort()).toEqual(['oauth', 'stripe']);
  });

  it('calls the injected resolver for a real conflict and applies its choice', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'main work', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');
    recordCheckpoint('feature', 'claude', 'feature work', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' },
    ], 'manual');

    await mergeCommand('feature', {}, { resolveConflict: async () => 'source' });

    expect(readFacts('main').map((f) => f.object)).toEqual(['razorpay']);
  });

  it('--auto tries the arbiter first and falls back to the human resolver when it returns null', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'main work', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');
    recordCheckpoint('feature', 'claude', 'feature work', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' },
    ], 'manual');

    let arbiterCalled = false;
    let humanCalled = false;
    await mergeCommand(
      'feature',
      { auto: true },
      {
        resolveViaArbiter: async () => { arbiterCalled = true; return null; },
        resolveConflict: async () => { humanCalled = true; return 'both'; },
      },
    );

    expect(arbiterCalled).toBe(true);
    expect(humanCalled).toBe(true);
    expect(readFacts('main')).toHaveLength(2);
  });

  it('--auto skips the human resolver entirely when the arbiter resolves the conflict', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'main work', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');
    recordCheckpoint('feature', 'claude', 'feature work', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' },
    ], 'manual');

    let humanCalled = false;
    await mergeCommand(
      'feature',
      { auto: true },
      {
        resolveViaArbiter: async () => 'target',
        resolveConflict: async () => { humanCalled = true; return 'both'; },
      },
    );

    expect(humanCalled).toBe(false);
    expect(readFacts('main').map((f) => f.object)).toEqual(['stripe']);
  });

  it('records a merge checkpoint with two parents on success', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    const mainFirst = recordCheckpoint('main', 'claude', 'main work', [], 'manual');
    const featureFirst = recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

    await mergeCommand('feature', {});

    const log = readLog('main');
    expect(log).toHaveLength(2);
    const mergeCheckpoint = readObject(log[1]);
    expect(mergeCheckpoint?.parents).toEqual([mainFirst.id, featureFirst.id]);
  });
});

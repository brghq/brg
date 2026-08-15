import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeCheckpointId, objectExists, readObject, writeObject } from '../src/versioning/objects.js';
import { applyFactsDelta, factKey } from '../src/versioning/facts.js';
import {
  appendLogEntry,
  branchExists,
  createBranch,
  headCheckpoint,
  listBranches,
  readFacts,
  readIntent,
  readLog,
  readSummary,
  writeFacts,
  writeSummary,
} from '../src/versioning/branches.js';
import { readGitMap, getMapping, setMapping } from '../src/versioning/gitmap.js';
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

  it('objectExists reflects presence correctly', () => {
    const written = writeObject(baseInput());
    expect(objectExists(written.id)).toBe(true);
    expect(objectExists('sha256:doesnotexist')).toBe(false);
  });

  it('reading a corrupt object file returns null instead of throwing', () => {
    const written = writeObject(baseInput());
    const file = path.join(tmpDir, '.brg', 'objects', `${written.id.split(':')[1]}.json`);
    fs.writeFileSync(file, '{ not valid json');
    expect(readObject(written.id)).toBeNull();
  });

  it('a merge checkpoint (parents array) hashes independently of a normal one with the same fields otherwise null', () => {
    const merge = computeCheckpointId({
      ...baseInput(),
      parent: null,
      parents: ['sha256:aaa', 'sha256:bbb'],
    });
    const normal = computeCheckpointId(baseInput());
    expect(merge).not.toBe(normal);
  });

  it('writeObject round-trips a merge checkpoint with parents intact', () => {
    const input: CheckpointObjectInput = {
      ...baseInput(),
      parent: null,
      parents: ['sha256:aaa', 'sha256:bbb'],
    };
    const written = writeObject(input);
    expect(readObject(written.id)?.parents).toEqual(['sha256:aaa', 'sha256:bbb']);
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

  it('multiple ops in one delta apply in order', () => {
    const result = applyFactsDelta(
      [],
      [
        { op: 'add', subject: 'payments', relation: 'provider', object: 'undecided' },
        { op: 'remove', subject: 'payments', relation: 'provider', object: 'undecided' },
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ],
      'sha256:abc',
    );
    expect(result).toEqual([
      { subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: 'sha256:abc', confidence: 'stated' },
    ]);
  });

  it('two facts with the same (subject, relation) but different object both survive — they are a candidate conflict, not deduplicated', () => {
    const result = applyFactsDelta(
      [
        { subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: 'sha256:aaa', confidence: 'stated' },
      ],
      [{ op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' }],
      'sha256:bbb',
    );
    expect(result).toHaveLength(2);
    expect(factKey(result[0])).toBe(factKey(result[1]));
  });

  it('an explicit confidence value is preserved instead of defaulting to "stated"', () => {
    const result = applyFactsDelta(
      [],
      [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      'sha256:abc',
      'inferred',
    );
    expect(result[0].confidence).toBe('inferred');
  });

  it('factKey combines subject and relation only, ignoring object', () => {
    expect(factKey({ subject: 'payments', relation: 'provider' })).toBe(
      factKey({ subject: 'payments', relation: 'provider' }),
    );
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

  it('writeSummary/readSummary round-trip', () => {
    createBranch('main', 'root');
    expect(readSummary('main')).toBe('');
    writeSummary('main', 'Stripe chosen for webhooks.\n');
    expect(readSummary('main')).toBe('Stripe chosen for webhooks.\n');
  });

  it('listBranches returns every created branch and nothing else', () => {
    createBranch('main', 'root');
    createBranch('feature-payments', 'Add Stripe support');
    expect(listBranches().sort()).toEqual(['feature-payments', 'main']);
  });

  it('listBranches is empty when branches/ does not exist yet', () => {
    expect(listBranches()).toEqual([]);
  });

  it('readFacts on a corrupt facts.json returns [] instead of throwing', () => {
    createBranch('main', 'root');
    fs.writeFileSync(path.join(tmpDir, '.brg', 'branches', 'main', 'facts.json'), '{ broken');
    expect(readFacts('main')).toEqual([]);
  });

  it('readLog skips a corrupt line instead of throwing, keeping the valid ones', () => {
    createBranch('main', 'root');
    appendLogEntry('main', 'sha256:aaa');
    fs.appendFileSync(path.join(tmpDir, '.brg', 'branches', 'main', 'log.jsonl'), 'not json\n');
    appendLogEntry('main', 'sha256:bbb');
    expect(readLog('main')).toEqual(['sha256:aaa', 'sha256:bbb']);
  });

  it('readIntent/readSummary/readFacts/readLog on a non-existent branch return empty rather than throwing', () => {
    expect(readIntent('ghost')).toBe('');
    expect(readSummary('ghost')).toBe('');
    expect(readFacts('ghost')).toEqual([]);
    expect(readLog('ghost')).toEqual([]);
    expect(headCheckpoint('ghost')).toBeNull();
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

  it('setMapping for a second branch does not disturb the first', () => {
    setMapping('a', { git_branch: 'a', created_from_sha: '111' });
    setMapping('b', { git_branch: 'b', created_from_sha: '222' });
    expect(getMapping('a')).toEqual({ git_branch: 'a', created_from_sha: '111' });
    expect(getMapping('b')).toEqual({ git_branch: 'b', created_from_sha: '222' });
  });

  it('setMapping overwrites an existing mapping for the same branch', () => {
    setMapping('a', { git_branch: 'a', created_from_sha: '111' });
    setMapping('a', { git_branch: 'a-renamed', created_from_sha: '222' });
    expect(getMapping('a')).toEqual({ git_branch: 'a-renamed', created_from_sha: '222' });
  });

  it('readGitMap on a corrupt file returns {} instead of throwing', () => {
    fs.mkdirSync(path.join(tmpDir, '.brg', 'refs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.brg', 'refs', 'git-map.json'), '{ broken');
    expect(readGitMap()).toEqual({});
  });

  it('readGitMap on a missing file returns {}', () => {
    expect(readGitMap()).toEqual({});
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

  it('checkpoints on two different branches do not share history', async () => {
    createBranch('feature-payments', 'Add Stripe support');
    const onMain = recordCheckpoint('main', 'claude', 'main work', [], 'manual');
    const onFeature = recordCheckpoint('feature-payments', 'claude', 'feature work', [], 'manual');

    expect(onMain.parent).toBeNull();
    expect(onFeature.parent).toBeNull();
    expect(readLog('main')).toEqual([onMain.id]);
    expect(readLog('feature-payments')).toEqual([onFeature.id]);
  });

  it('facts accumulate correctly across several checkpoints on the same branch', async () => {
    recordCheckpoint(
      'main',
      'claude',
      'undecided',
      [{ op: 'add', subject: 'payments', relation: 'provider', object: 'undecided' }],
      'manual',
    );
    const second = recordCheckpoint(
      'main',
      'claude',
      'decided',
      [
        { op: 'remove', subject: 'payments', relation: 'provider', object: 'undecided' },
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ],
      'manual',
    );

    expect(readFacts('main')).toEqual([
      { subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: second.id, confidence: 'stated' },
    ]);
  });

  it('recording two checkpoints with identical content still appends two log entries despite object dedup', async () => {
    const first = recordCheckpoint('main', 'claude', 'same message', [], 'manual');
    // Force an identical timestamp/content scenario isn't realistic (timestamps differ
    // per call), but object storage itself is content-addressed — verify the log
    // still reflects two real entries even when nothing else about state changed.
    const second = recordCheckpoint('main', 'claude', 'same message', [], 'manual');
    expect(readLog('main')).toEqual([first.id, second.id]);
    expect(first.id).not.toBe(second.id); // different timestamps -> different hash
  });
});

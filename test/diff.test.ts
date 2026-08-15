import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffFacts } from '../src/versioning/diff.js';
import { createBranch, writeFacts } from '../src/versioning/branches.js';
import { diffCommand } from '../src/commands/diff.js';
import type { Fact } from '../src/versioning/types.js';

const fact = (subject: string, relation: string, object: string, checkpoint = 'sha256:x'): Fact => ({
  subject,
  relation,
  object,
  checkpoint,
  confidence: 'stated',
});

describe('versioning/diff', () => {
  it('returns [] for two identical fact sets', () => {
    const facts = [fact('payments', 'provider', 'stripe')];
    expect(diffFacts(facts, facts)).toEqual([]);
  });

  it('returns [] for two empty fact sets', () => {
    expect(diffFacts([], [])).toEqual([]);
  });

  it('flags a fact only in b as added', () => {
    const result = diffFacts([], [fact('payments', 'provider', 'stripe')]);
    expect(result).toEqual([
      { kind: 'added', subject: 'payments', relation: 'provider', object: 'stripe' },
    ]);
  });

  it('flags a fact only in a as removed', () => {
    const result = diffFacts([fact('payments', 'provider', 'stripe')], []);
    expect(result).toEqual([
      { kind: 'removed', subject: 'payments', relation: 'provider', object: 'stripe' },
    ]);
  });

  it('flags same (subject, relation) with different object as changed, not add+remove', () => {
    const result = diffFacts(
      [fact('payments', 'provider', 'stripe')],
      [fact('payments', 'provider', 'razorpay')],
    );
    expect(result).toEqual([
      { kind: 'changed', subject: 'payments', relation: 'provider', from: ['stripe'], to: ['razorpay'] },
    ]);
  });

  it('unrelated facts on both sides do not show up in the diff', () => {
    const shared = fact('payments', 'provider', 'stripe');
    const result = diffFacts([shared], [shared]);
    expect(result).toEqual([]);
  });

  it('results are sorted by subject+relation for stable output', () => {
    const result = diffFacts(
      [],
      [fact('zeta', 'x', '1'), fact('alpha', 'x', '1')],
    );
    expect(result.map((e) => e.subject)).toEqual(['alpha', 'zeta']);
  });

  it('multiple independent changes are all reported', () => {
    const a = [fact('payments', 'provider', 'stripe'), fact('auth', 'method', 'oauth')];
    const b = [fact('payments', 'provider', 'stripe'), fact('auth', 'method', 'saml'), fact('db', 'engine', 'postgres')];
    const result = diffFacts(a, b);
    expect(result).toEqual([
      { kind: 'changed', subject: 'auth', relation: 'method', from: ['oauth'], to: ['saml'] },
      { kind: 'added', subject: 'db', relation: 'engine', object: 'postgres' },
    ]);
  });
});

describe('brg diff command', () => {
  let cwd: string;
  let tmpDir: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-diff-'));
    process.chdir(tmpDir);
    logs = [];
    errors = [];
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function captureConsole<T>(fn: () => T): T {
    const origLog = console.log;
    const origError = console.error;
    console.log = (msg?: unknown) => logs.push(String(msg));
    console.error = (msg?: unknown) => errors.push(String(msg));
    try {
      return fn();
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  }

  it('errors without crashing when a branch has no brg context', () => {
    createBranch('main', 'root');
    captureConsole(() => diffCommand('main', 'does-not-exist'));
    expect(process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes('does-not-exist'))).toBe(true);
  });

  it('reports no differences for two branches with identical facts', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    writeFacts('main', [fact('payments', 'provider', 'stripe')]);
    writeFacts('feature', [fact('payments', 'provider', 'stripe')]);

    captureConsole(() => diffCommand('main', 'feature'));

    expect(process.exitCode ?? 0).toBe(0);
    expect(logs.some((l) => l.includes('No fact differences'))).toBe(true);
  });

  it('prints a line per diff entry for branches with different facts', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    writeFacts('main', [fact('payments', 'provider', 'stripe')]);
    writeFacts('feature', [fact('payments', 'provider', 'razorpay')]);

    captureConsole(() => diffCommand('main', 'feature'));

    expect(logs.some((l) => l.includes('provider') && l.includes('stripe') && l.includes('razorpay'))).toBe(true);
  });
});

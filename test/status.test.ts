import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { statusCommand } from '../src/commands/status.js';
import { initCommand } from '../src/commands/init.js';
import { checkoutCommand } from '../src/commands/checkout.js';
import { setMapping } from '../src/versioning/gitmap.js';

describe('brg status', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-status-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not crash on an empty/uninitialized directory', () => {
    expect(() => statusCommand()).not.toThrow();
  });

  it('does not crash once initialized with no checkpoints', () => {
    initCommand();
    expect(() => statusCommand()).not.toThrow();
  });
});

describe('brg status — git branch and mismatch warning', () => {
  let cwd: string;
  let tmpDir: string;
  let logs: string[];

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-status-git-'));
    process.chdir(tmpDir);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: tmpDir });
    initCommand();
    logs = [];
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function captureLogs(fn: () => void): void {
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      fn();
    } finally {
      console.log = orig;
    }
  }

  it('shows the actual current git branch as a distinct field', () => {
    captureLogs(() => statusCommand());
    expect(logs.some((l) => l.startsWith('git branch:') && l.includes('main'))).toBe(true);
  });

  it('no warning when the active branch is correctly linked to the checked-out git branch', () => {
    captureLogs(() => statusCommand());
    expect(logs.some((l) => l.includes('⚠'))).toBe(false);
  });

  it('warns when the active branch has no linked git branch at all', async () => {
    // "main" is auto-created by init and auto-linked to git's "main" —
    // create a second, unlinked context branch and switch to it.
    await checkoutCommand(
      'angle-a',
      { orphan: true, intent: 'explore' },
      { confirmGitBranch: async () => ({ create: false }) },
    );

    captureLogs(() => statusCommand());

    expect(logs.some((l) => l.includes('⚠') && l.includes('no linked git branch'))).toBe(true);
  });

  it('warns when the active branch\'s linked git branch differs from the actual checked-out one', async () => {
    execFileSync('git', ['checkout', '-b', 'other-branch'], { cwd: tmpDir });
    // "main" context branch is still linked to git branch "main", but
    // we're now sitting on "other-branch" without switching context.
    setMapping('main', { git_branch: 'main', created_from_sha: 'deadbeef' });

    captureLogs(() => statusCommand());

    expect(
      logs.some((l) => l.includes('⚠') && l.includes('linked to git branch "main"') && l.includes('other-branch')),
    ).toBe(true);
  });

  it('no warning outside a git repo', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-status-nongit-'));
    process.chdir(nonGitDir);
    initCommand();

    captureLogs(() => statusCommand());

    expect(logs.some((l) => l.includes('⚠'))).toBe(false);
    expect(logs.some((l) => l.includes('git branch:') && l.includes('not a git repo'))).toBe(true);

    process.chdir(tmpDir);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });
});

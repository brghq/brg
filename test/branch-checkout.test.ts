import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { branchCommand } from '../src/commands/branch.js';
import { checkoutCommand } from '../src/commands/checkout.js';
import { initCommand } from '../src/commands/init.js';
import { branchExists, readIntent } from '../src/versioning/branches.js';
import { getMapping } from '../src/versioning/gitmap.js';
import { installPostCheckoutHook } from '../src/versioning/hook.js';

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: dir });
}

function currentGitBranchName(dir: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).toString().trim();
}

describe('brg branch / brg checkout', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-branch-'));
    process.chdir(tmpDir);
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a real git branch and matching brg context with --intent', async () => {
    const startingBranch = currentGitBranchName(tmpDir);
    await branchCommand('feature-payments', { intent: 'Add Stripe support' });

    // git branch (without checkout) does not switch HEAD.
    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);
    const branches = execFileSync('git', ['branch', '--list', 'feature-payments'], { cwd: tmpDir })
      .toString();
    expect(branches).toContain('feature-payments');

    expect(branchExists('feature-payments')).toBe(true);
    expect(readIntent('feature-payments')).toBe('Add Stripe support\n');
    expect(getMapping('feature-payments')?.git_branch).toBe('feature-payments');
    expect(getMapping('feature-payments')?.created_from_sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('refuses to recreate a branch that already has brg context', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' });
    await branchCommand('feature-payments', { intent: 'different intent' });

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(readIntent('feature-payments')).toBe('Add Stripe support\n');
  });

  it('checkout switches git HEAD and restores brg context for a known branch', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' });
    await checkoutCommand('feature-payments');

    expect(currentGitBranchName(tmpDir)).toBe('feature-payments');
  });

  it('checkout still succeeds for a plain git branch with no brg context', async () => {
    execFileSync('git', ['branch', 'plain-branch'], { cwd: tmpDir });
    await checkoutCommand('plain-branch');

    expect(currentGitBranchName(tmpDir)).toBe('plain-branch');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('checkout of a non-existent branch fails with git\'s own exit code', async () => {
    await checkoutCommand('does-not-exist');
    expect(process.exitCode).not.toBe(0);
    process.exitCode = 0;
  });

  it('installPostCheckoutHook writes an executable hook inside a git repo', () => {
    installPostCheckoutHook();
    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-checkout');
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.readFileSync(hookPath, 'utf8')).toContain('brg:post-checkout-safety-net');
  });

  it('installPostCheckoutHook does not overwrite a foreign existing hook', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'post-checkout');
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "someone else\'s hook"\n');

    installPostCheckoutHook();

    expect(fs.readFileSync(hookPath, 'utf8')).toContain("someone else's hook");
  });

  it('brg init installs the hook without disturbing Phase 1 behavior', () => {
    initCommand();
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'context.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.git', 'hooks', 'post-checkout'))).toBe(true);
  });

  it('installPostCheckoutHook no-ops outside a git repo', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nongit-'));
    process.chdir(nonGitDir);
    expect(() => installPostCheckoutHook()).not.toThrow();
    expect(fs.existsSync(path.join(nonGitDir, '.git'))).toBe(false);
    process.chdir(tmpDir);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });
});

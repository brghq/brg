import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { branchCommand } from '../src/commands/branch.js';
import { checkoutCommand } from '../src/commands/checkout.js';
import { initCommand } from '../src/commands/init.js';
import { getActiveBranch } from '../src/versioning/active.js';
import { branchExists, readIntent } from '../src/versioning/branches.js';
import { getMapping } from '../src/versioning/gitmap.js';
import { installPostCheckoutHook } from '../src/versioning/hook.js';

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: dir });
}

function currentGitBranchName(dir: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).toString().trim();
}

// Test double for the interactive "also create a git branch?" prompt —
// avoids driving real stdin/readline in tests.
const declineGit = async () => ({ create: false });
const acceptGit = (name?: string) => async () => ({ create: true, name });

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

  it('creates a brg branch immediately, before the git-branch question is even asked', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: declineGit });

    expect(branchExists('feature-payments')).toBe(true);
    expect(readIntent('feature-payments')).toBe('Add Stripe support\n');
  });

  it('declining the git-branch prompt leaves the brg branch with no git-map entry, and no git branch is created', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: declineGit });

    expect(getMapping('feature-payments')).toBeUndefined();
    const branches = execFileSync('git', ['branch', '--list', 'feature-payments'], { cwd: tmpDir }).toString();
    expect(branches).not.toContain('feature-payments');
  });

  it('accepting the git-branch prompt with a name creates the git branch and records the mapping', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: acceptGit('feature-payments') });

    const branches = execFileSync('git', ['branch', '--list', 'feature-payments'], { cwd: tmpDir }).toString();
    expect(branches).toContain('feature-payments');
    expect(getMapping('feature-payments')?.git_branch).toBe('feature-payments');
    expect(getMapping('feature-payments')?.created_from_sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('accepting with a different name than the brg branch creates git branch under that name', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: acceptGit('payments-work') });

    const branches = execFileSync('git', ['branch', '--list', 'payments-work'], { cwd: tmpDir }).toString();
    expect(branches).toContain('payments-work');
    expect(getMapping('feature-payments')?.git_branch).toBe('payments-work');
  });

  it('accepting with no typed name (blank) defaults the git branch name to the brg branch name', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: acceptGit(undefined) });

    expect(getMapping('feature-payments')?.git_branch).toBe('feature-payments');
  });

  it('creating a git branch does not switch HEAD — brg branch only creates, never checks out', async () => {
    const startingBranch = currentGitBranchName(tmpDir);
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: acceptGit('feature-payments') });

    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);
  });

  it('sets the new branch as active regardless of the git-branch decision', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: declineGit });
    expect(getActiveBranch()).toBe('feature-payments');
  });

  it('refuses to recreate a branch that already has brg context', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: declineGit });
    await branchCommand('feature-payments', { intent: 'different intent' }, { confirmGitBranch: declineGit });

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(readIntent('feature-payments')).toBe('Add Stripe support\n');
  });

  it('branchCommand outside a git repo skips the git-branch question entirely, never calling the resolver', async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nongit-branch-'));
    process.chdir(nonGitDir);

    let confirmCalled = false;
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, {
      confirmGitBranch: async () => {
        confirmCalled = true;
        return { create: true };
      },
    });

    expect(confirmCalled).toBe(false);
    expect(branchExists('feature-payments')).toBe(true);

    process.chdir(tmpDir);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('checkout switches git HEAD and restores brg context for a branch with a matching git branch', async () => {
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: acceptGit('feature-payments') });
    await checkoutCommand('feature-payments');

    expect(currentGitBranchName(tmpDir)).toBe('feature-payments');
    expect(getActiveBranch()).toBe('feature-payments');
  });

  it('checkout of a brg branch with no git branch does NOT touch git HEAD — pure context switch', async () => {
    const startingBranch = currentGitBranchName(tmpDir);
    await branchCommand('feature-payments', { intent: 'Add Stripe support' }, { confirmGitBranch: declineGit });

    await checkoutCommand('feature-payments');

    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);
    expect(getActiveBranch()).toBe('feature-payments');
  });

  it('can switch between two context-only branches while staying on the same git branch throughout', async () => {
    const startingBranch = currentGitBranchName(tmpDir);
    await branchCommand('angle-a', { intent: 'Explore approach A' }, { confirmGitBranch: declineGit });
    await branchCommand('angle-b', { intent: 'Explore approach B' }, { confirmGitBranch: declineGit });

    await checkoutCommand('angle-a');
    expect(getActiveBranch()).toBe('angle-a');
    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);

    await checkoutCommand('angle-b');
    expect(getActiveBranch()).toBe('angle-b');
    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);
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

  it('brg init installs the hook and activates a default branch matching the checked-out git branch', () => {
    initCommand();
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.git', 'hooks', 'post-checkout'))).toBe(true);
    expect(getActiveBranch()).toBe('main');
    expect(branchExists('main')).toBe(true);
    expect(getMapping('main')?.git_branch).toBe('main');
  });

  it('brg init outside a git repo activates a branch named "main" with no git mapping', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nongit-init-'));
    process.chdir(nonGitDir);

    initCommand();

    expect(getActiveBranch()).toBe('main');
    expect(getMapping('main')).toBeUndefined();

    process.chdir(tmpDir);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('re-running brg init backfills the default branch for a project initialized before this existed', () => {
    // Simulate a pre-existing .brg/ that predates active-branch tracking:
    // init once, then delete the active pointer to mimic an older project.
    initCommand();
    fs.rmSync(path.join(tmpDir, '.brg', 'refs', 'active'));
    expect(getActiveBranch()).toBeNull();

    initCommand();

    expect(getActiveBranch()).toBe('main');
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

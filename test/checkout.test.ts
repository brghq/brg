import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkoutCommand } from '../src/commands/checkout.js';
import { initCommand } from '../src/commands/init.js';
import { getActiveBranch, setActiveBranch } from '../src/versioning/active.js';
import { branchExists, createBranch, readFacts, readIntent, writeFacts } from '../src/versioning/branches.js';
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

// Test doubles for the interactive prompts — avoids driving real
// stdin/readline in tests.
const declineGit = async () => ({ create: false });
const acceptGit = (name?: string) => async () => ({ create: true, name });
const answerOrphan = async () => ({ inherit: false });
const answerInherit = async () => ({ inherit: true });

describe('brg checkout — creating a new branch', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-checkout-'));
    process.chdir(tmpDir);
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a brg branch immediately, before the git-branch question is even asked', async () => {
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true },
      { confirmGitBranch: declineGit },
    );

    expect(branchExists('feature-payments')).toBe(true);
    expect(readIntent('feature-payments')).toBe('Add Stripe support\n');
  });

  it('declining the git-branch prompt leaves the brg branch with no git-map entry, and no git branch is created', async () => {
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true },
      { confirmGitBranch: declineGit },
    );

    expect(getMapping('feature-payments')).toBeUndefined();
    const branches = execFileSync('git', ['branch', '--list', 'feature-payments'], { cwd: tmpDir }).toString();
    expect(branches).not.toContain('feature-payments');
  });

  it('accepting the git-branch prompt with a name creates the git branch and records the mapping', async () => {
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true },
      { confirmGitBranch: acceptGit('feature-payments') },
    );

    const branches = execFileSync('git', ['branch', '--list', 'feature-payments'], { cwd: tmpDir }).toString();
    expect(branches).toContain('feature-payments');
    expect(getMapping('feature-payments')?.git_branch).toBe('feature-payments');
    expect(getMapping('feature-payments')?.created_from_sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('--git (flag, no name) creates a git branch matching the brg branch name, no prompt', async () => {
    let promptCalled = false;
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true, git: true },
      { confirmGitBranch: async () => { promptCalled = true; return { create: false }; } },
    );

    expect(promptCalled).toBe(false);
    expect(getMapping('feature-payments')?.git_branch).toBe('feature-payments');
  });

  it('--git=<name> (flag with custom name) links under that name, no prompt', async () => {
    let promptCalled = false;
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true, git: 'payments-work' },
      { confirmGitBranch: async () => { promptCalled = true; return { create: false }; } },
    );

    expect(promptCalled).toBe(false);
    expect(getMapping('feature-payments')?.git_branch).toBe('payments-work');
  });

  it('--no-git (flag, explicit) skips linking, no prompt', async () => {
    let promptCalled = false;
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true, git: false },
      { confirmGitBranch: async () => { promptCalled = true; return { create: true }; } },
    );

    expect(promptCalled).toBe(false);
    expect(getMapping('feature-payments')).toBeUndefined();
  });

  it('accepting with a different name than the brg branch creates git branch under that name', async () => {
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true },
      { confirmGitBranch: acceptGit('payments-work') },
    );

    const branches = execFileSync('git', ['branch', '--list', 'payments-work'], { cwd: tmpDir }).toString();
    expect(branches).toContain('payments-work');
    expect(getMapping('feature-payments')?.git_branch).toBe('payments-work');
  });

  it('accepting with no typed name (blank) defaults the git branch name to the brg branch name', async () => {
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true },
      { confirmGitBranch: acceptGit(undefined) },
    );

    expect(getMapping('feature-payments')?.git_branch).toBe('feature-payments');
  });

  it('creating a git branch does not switch HEAD — only creates, never checks out', async () => {
    const startingBranch = currentGitBranchName(tmpDir);
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true },
      { confirmGitBranch: acceptGit('feature-payments') },
    );

    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);
  });

  it('sets the new branch as active regardless of the git-branch decision', async () => {
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true },
      { confirmGitBranch: declineGit },
    );
    expect(getActiveBranch()).toBe('feature-payments');
  });

  it('outside a git repo, skips the git-branch question entirely, never calling the resolver', async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nongit-checkout-'));
    process.chdir(nonGitDir);

    let confirmCalled = false;
    await checkoutCommand(
      'feature-payments',
      { intent: 'Add Stripe support', orphan: true },
      { confirmGitBranch: async () => { confirmCalled = true; return { create: true }; } },
    );

    expect(confirmCalled).toBe(false);
    expect(branchExists('feature-payments')).toBe(true);

    process.chdir(tmpDir);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('creating a brg branch whose name matches an existing real git branch does not touch that git branch (default: no git link)', async () => {
    execFileSync('git', ['branch', 'feature-payments'], { cwd: tmpDir });
    const startingBranch = currentGitBranchName(tmpDir);

    await checkoutCommand('feature-payments', { intent: 'Add Stripe support', orphan: true }, { confirmGitBranch: declineGit });

    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);
    expect(getMapping('feature-payments')).toBeUndefined();
  });

  describe('inherit vs orphan', () => {
    beforeEach(() => {
      createBranch('main', 'root');
      setActiveBranch('main');
      writeFacts('main', [
        { subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: 'sha256:x', confidence: 'stated' },
      ]);
    });

    it('--orphan starts with no inherited facts', async () => {
      await checkoutCommand('angle-a', { intent: 'explore', orphan: true }, { confirmGitBranch: declineGit });
      expect(readFacts('angle-a')).toEqual([]);
    });

    it('--inherit copies the current active branch\'s facts as a starting point', async () => {
      await checkoutCommand('angle-a', { intent: 'explore', inherit: true }, { confirmGitBranch: declineGit });
      expect(readFacts('angle-a')).toEqual(readFacts('main'));
      expect(readFacts('angle-a')).toHaveLength(1);
    });

    it('interactive inherit prompt (no flag) is used when neither --inherit nor --orphan is passed', async () => {
      await checkoutCommand(
        'angle-a',
        { intent: 'explore' },
        { confirmInherit: answerInherit, confirmGitBranch: declineGit },
      );
      expect(readFacts('angle-a')).toHaveLength(1);
    });

    it('interactive orphan answer results in no inherited facts', async () => {
      await checkoutCommand(
        'angle-a',
        { intent: 'explore' },
        { confirmInherit: answerOrphan, confirmGitBranch: declineGit },
      );
      expect(readFacts('angle-a')).toEqual([]);
    });

    it('--inherit with no currently active branch just proceeds orphan (nothing to inherit from)', async () => {
      const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-checkout-noactive-'));
      process.chdir(freshDir);
      await checkoutCommand('first', { intent: 'first branch', inherit: true }, { confirmGitBranch: declineGit });
      expect(readFacts('first')).toEqual([]);
      process.chdir(tmpDir);
      fs.rmSync(freshDir, { recursive: true, force: true });
    });
  });
});

describe('brg checkout — switching to an existing branch', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-checkout-switch-'));
    process.chdir(tmpDir);
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('never errors for an existing name — always switches, per the spec (no "already exists" failure)', async () => {
    await checkoutCommand('feature-payments', { intent: 'Add Stripe support', orphan: true }, { confirmGitBranch: declineGit });
    setActiveBranch('main'); // simulate having moved away
    createBranch('main', 'root');

    await expect(
      checkoutCommand('feature-payments'),
    ).resolves.toBeUndefined();

    expect(process.exitCode ?? 0).toBe(0);
    expect(getActiveBranch()).toBe('feature-payments');
    // Original intent is untouched — switching never re-creates.
    expect(readIntent('feature-payments')).toBe('Add Stripe support\n');
  });

  it('switching to an existing branch never calls the create-time prompts', async () => {
    await checkoutCommand('feature-payments', { intent: 'Add Stripe support', orphan: true }, { confirmGitBranch: declineGit });

    let gitPromptCalled = false;
    let inheritPromptCalled = false;
    await checkoutCommand('feature-payments', {}, {
      confirmGitBranch: async () => { gitPromptCalled = true; return { create: false }; },
      confirmInherit: async () => { inheritPromptCalled = true; return { inherit: false }; },
    });

    expect(gitPromptCalled).toBe(false);
    expect(inheritPromptCalled).toBe(false);
  });

  it('switches git HEAD and restores brg context for a branch with a matching git branch', async () => {
    await checkoutCommand('feature-payments', { intent: 'Add Stripe support', orphan: true }, { confirmGitBranch: acceptGit('feature-payments') });
    await checkoutCommand('feature-payments');

    expect(currentGitBranchName(tmpDir)).toBe('feature-payments');
    expect(getActiveBranch()).toBe('feature-payments');
  });

  it('a brg branch with no linked git branch does NOT touch git HEAD — pure context switch', async () => {
    const startingBranch = currentGitBranchName(tmpDir);
    await checkoutCommand('feature-payments', { intent: 'Add Stripe support', orphan: true }, { confirmGitBranch: declineGit });

    await checkoutCommand('feature-payments');

    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);
    expect(getActiveBranch()).toBe('feature-payments');
  });

  it('can switch between two context-only branches while staying on the same git branch throughout', async () => {
    const startingBranch = currentGitBranchName(tmpDir);
    await checkoutCommand('angle-a', { intent: 'Explore approach A', orphan: true }, { confirmGitBranch: declineGit });
    await checkoutCommand('angle-b', { intent: 'Explore approach B', orphan: true }, { confirmGitBranch: declineGit });

    await checkoutCommand('angle-a');
    expect(getActiveBranch()).toBe('angle-a');
    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);

    await checkoutCommand('angle-b');
    expect(getActiveBranch()).toBe('angle-b');
    expect(currentGitBranchName(tmpDir)).toBe(startingBranch);
  });

  it('fails with git\'s own exit code if the linked git branch no longer exists', async () => {
    await checkoutCommand('feature-payments', { intent: 'Add Stripe support', orphan: true }, { confirmGitBranch: acceptGit('feature-payments') });
    execFileSync('git', ['branch', '-D', 'feature-payments'], { cwd: tmpDir });

    await checkoutCommand('feature-payments');

    expect(process.exitCode).not.toBe(0);
    process.exitCode = 0;
  });
});

describe('post-checkout git hook', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-hook-'));
    process.chdir(tmpDir);
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  it('installPostCheckoutHook no-ops outside a git repo', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nongit-'));
    process.chdir(nonGitDir);
    expect(() => installPostCheckoutHook()).not.toThrow();
    expect(fs.existsSync(path.join(nonGitDir, '.git'))).toBe(false);
    process.chdir(tmpDir);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('the installed hook script never executes brg checkout or touches the active-branch pointer directly', () => {
    installPostCheckoutHook();
    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-checkout');
    const script = fs.readFileSync(hookPath, 'utf8');
    // The message may *mention* `brg checkout` as a suggestion (inside an
    // echo string) — what must never happen is the hook actually running
    // it or writing refs/active itself. No line may start with `brg ` or
    // reference the active-ref path outside of that echoed suggestion.
    const executableLines = script
      .split('\n')
      .filter((line) => !line.trim().startsWith('#') && !line.includes('echo'));
    expect(executableLines.some((line) => line.includes('brg '))).toBe(false);
    expect(script).not.toContain('.brg/refs/active');
  });

  it('running the real installed hook does not change the active branch pointer', () => {
    createBranch('feature-payments', 'root');
    setActiveBranch('main-ish'); // arbitrary — no branch of this name needs to exist for this check
    installPostCheckoutHook();

    // Trigger the hook through a real `git checkout`, the way it actually
    // fires in practice — invoking the hook file directly via the OS isn't
    // portable (Windows has no shebang association for a plain `#!/bin/sh`
    // script; git itself resolves and runs hooks via its own bundled shell
    // on every platform).
    execFileSync('git', ['checkout', '-b', 'feature-payments'], { cwd: tmpDir });

    expect(getActiveBranch()).toBe('main-ish');
  });
});

describe('brg init', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-init-checkout-'));
    process.chdir(tmpDir);
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installs the hook and activates a default branch matching the checked-out git branch', () => {
    initCommand();
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.git', 'hooks', 'post-checkout'))).toBe(true);
    expect(getActiveBranch()).toBe('main');
    expect(branchExists('main')).toBe(true);
    expect(getMapping('main')?.git_branch).toBe('main');
  });

  it('outside a git repo activates a branch named "main" with no git mapping', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nongit-init-'));
    process.chdir(nonGitDir);

    initCommand();

    expect(getActiveBranch()).toBe('main');
    expect(getMapping('main')).toBeUndefined();

    process.chdir(tmpDir);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('re-running brg init backfills the default branch for a project initialized before this existed', () => {
    initCommand();
    fs.rmSync(path.join(tmpDir, '.brg', 'refs', 'active'));
    expect(getActiveBranch()).toBeNull();

    initCommand();

    expect(getActiveBranch()).toBe('main');
  });
});

import { execFileSync } from 'node:child_process';
import spawn from 'cross-spawn';

// Thin wrapper around real git — never reimplements git behavior, just
// spawns it. Keeps "which git branch does this map to" logic in one place
// so commands/branch.ts and commands/checkout.ts don't each shell out
// differently.

export function currentGitSha(cwd: string = process.cwd()): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function currentGitBranch(cwd: string = process.cwd()): string | null {
  try {
    const name = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    // Detached HEAD: rev-parse --abbrev-ref returns the literal "HEAD",
    // which isn't a real branch name — callers need null, not that string.
    return name && name !== 'HEAD' ? name : null;
  } catch {
    return null;
  }
}

export function isGitRepo(cwd: string = process.cwd()): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function gitBranchExists(name: string, cwd: string = process.cwd()): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `git branch <args>` with inherited stdio, returning git's own exit
 * code unchanged — brg does not reinterpret git's success/failure.
 */
export function runGitBranch(args: string[], cwd: string = process.cwd()): number {
  const result = spawn.sync('git', ['branch', ...args], { cwd, stdio: 'inherit' });
  return result.status ?? 1;
}

/**
 * Runs `git checkout <args>` with inherited stdio, returning git's own
 * exit code unchanged.
 */
export function runGitCheckout(args: string[], cwd: string = process.cwd()): number {
  const result = spawn.sync('git', ['checkout', ...args], { cwd, stdio: 'inherit' });
  return result.status ?? 1;
}

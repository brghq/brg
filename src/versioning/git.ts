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

/**
 * File paths with uncommitted changes in the working tree right now —
 * paths only, never diff content or file contents (git already owns
 * that, and duplicating it risks the two going out of sync). Excludes
 * `.brg/` itself: recording a checkpoint necessarily writes there, so
 * without this every single checkpoint would list its own bookkeeping as
 * a "touched file" — noise, not signal, about the actual project work.
 * Returns [] outside a git repo or on any git error, same
 * "reference is best-effort" posture as currentGitSha.
 */
export function changedFiles(cwd: string = process.cwd()): string[] {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return output
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((path) => path.length > 0 && path !== '.brg/' && !path.startsWith('.brg/'));
  } catch {
    return [];
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

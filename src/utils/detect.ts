import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Returns true if `binary` resolves on PATH (`which`/`where`), false otherwise.
 * Never throws — a missing binary is a normal, expected outcome here.
 */
export function isOnPath(binary: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(finder, [binary], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if any of the given paths (files or directories) exist,
 * after expanding a leading `~` to the user's home directory.
 */
export function anyPathExists(paths: string[]): boolean {
  return paths.some((p) => existsSync(expandHome(p)));
}

function expandHome(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

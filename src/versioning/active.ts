import fs from 'node:fs';
import { activePath, refsDir } from './paths.js';

// Which brg branch is "current" can no longer be derived purely from the
// checked-out git branch — a brg branch created without a matching git
// branch (see commands/branch.ts) has nothing for git to tell us. This is
// the explicit source of truth instead: set by `brg branch`/`brg
// checkout`, read by `brg merge` and anything else that needs "the
// branch I'm currently working in."

export function getActiveBranch(cwd: string = process.cwd()): string | null {
  const file = activePath(cwd);
  if (!fs.existsSync(file)) return null;
  const name = fs.readFileSync(file, 'utf8').trim();
  return name || null;
}

export function setActiveBranch(name: string, cwd: string = process.cwd()): void {
  fs.mkdirSync(refsDir(cwd), { recursive: true });
  fs.writeFileSync(activePath(cwd), `${name}\n`, 'utf8');
}

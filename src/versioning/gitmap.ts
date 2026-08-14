import fs from 'node:fs';
import { gitMapPath, refsDir } from './paths.js';
import type { GitMap, GitMapEntry } from './types.js';

/**
 * Reads refs/git-map.json. Returns an empty map (with a warning) for a
 * missing or corrupt file, same tolerance-over-crashing precedent as the
 * rest of this directory — resolving a branch shouldn't take down
 * `brg checkout` over a hand-edited file.
 */
export function readGitMap(cwd: string = process.cwd()): GitMap {
  const file = gitMapPath(cwd);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as GitMap;
  } catch {
    console.error(`brg: ${file} is corrupt, treating git-map as empty`);
    return {};
  }
}

export function writeGitMap(map: GitMap, cwd: string = process.cwd()): void {
  fs.mkdirSync(refsDir(cwd), { recursive: true });
  const file = gitMapPath(cwd);
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(map, null, 2), 'utf8');
  fs.renameSync(tmpFile, file);
}

export function getMapping(brgBranch: string, cwd: string = process.cwd()): GitMapEntry | undefined {
  return readGitMap(cwd)[brgBranch];
}

export function setMapping(
  brgBranch: string,
  entry: GitMapEntry,
  cwd: string = process.cwd(),
): void {
  const map = readGitMap(cwd);
  map[brgBranch] = entry;
  writeGitMap(map, cwd);
}

import path from 'node:path';
import { brgDir } from '../core/config.js';

// Single source of truth for where every versioning file lives under
// .brg/. Every other file in this directory imports paths from here
// instead of joining path segments itself, so the on-disk layout can
// change in one place without hunting through objects.ts/branches.ts/
// gitmap.ts for hardcoded paths.

export function objectsDir(cwd: string = process.cwd()): string {
  return path.join(brgDir(cwd), 'objects');
}

export function objectPath(id: string, cwd: string = process.cwd()): string {
  // ids are content hashes formatted "sha256:<hex>" — strip the scheme for
  // the filename, keep it in the stored `id` field.
  const hex = id.includes(':') ? id.split(':', 2)[1] : id;
  return path.join(objectsDir(cwd), `${hex}.json`);
}

export function branchesDir(cwd: string = process.cwd()): string {
  return path.join(brgDir(cwd), 'branches');
}

export function branchDir(name: string, cwd: string = process.cwd()): string {
  return path.join(branchesDir(cwd), name);
}

export function branchIntentPath(name: string, cwd: string = process.cwd()): string {
  return path.join(branchDir(name, cwd), 'intent.md');
}

export function branchSummaryPath(name: string, cwd: string = process.cwd()): string {
  return path.join(branchDir(name, cwd), 'summary.md');
}

export function branchFactsPath(name: string, cwd: string = process.cwd()): string {
  return path.join(branchDir(name, cwd), 'facts.json');
}

export function branchLogPath(name: string, cwd: string = process.cwd()): string {
  return path.join(branchDir(name, cwd), 'log.jsonl');
}

export function refsDir(cwd: string = process.cwd()): string {
  return path.join(brgDir(cwd), 'refs');
}

export function gitMapPath(cwd: string = process.cwd()): string {
  return path.join(refsDir(cwd), 'git-map.json');
}

import fs from 'node:fs';
import {
  branchDir,
  branchFactsPath,
  branchIntentPath,
  branchLogPath,
  branchSummaryPath,
  branchesDir,
} from './paths.js';
import type { Fact } from './types.js';

export function branchExists(name: string, cwd: string = process.cwd()): boolean {
  return fs.existsSync(branchDir(name, cwd));
}

export function listBranches(cwd: string = process.cwd()): string[] {
  const dir = branchesDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((entry) => branchExists(entry, cwd));
}

/**
 * Creates a branch's on-disk structure: intent.md, empty summary.md,
 * empty facts.json, empty log.jsonl. Throws if the branch already exists
 * — callers (module 2's `brg branch`) decide how to surface that, this
 * layer just refuses to silently clobber an existing branch's history.
 */
export function createBranch(name: string, intent: string, cwd: string = process.cwd()): void {
  if (branchExists(name, cwd)) {
    throw new Error(`branch "${name}" already exists`);
  }
  fs.mkdirSync(branchDir(name, cwd), { recursive: true });
  fs.writeFileSync(branchIntentPath(name, cwd), intent.endsWith('\n') ? intent : `${intent}\n`, 'utf8');
  fs.writeFileSync(branchSummaryPath(name, cwd), '', 'utf8');
  fs.writeFileSync(branchFactsPath(name, cwd), '[]\n', 'utf8');
  fs.writeFileSync(branchLogPath(name, cwd), '', 'utf8');
}

export function readIntent(name: string, cwd: string = process.cwd()): string {
  const file = branchIntentPath(name, cwd);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export function readSummary(name: string, cwd: string = process.cwd()): string {
  const file = branchSummaryPath(name, cwd);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// Atomic write (tmp + rename): summary.md is regenerated on every
// checkpoint (see versioning/summary.ts), so it's written far more often
// than facts.json — worth the same crash-safety as writeFacts already has.
export function writeSummary(name: string, summary: string, cwd: string = process.cwd()): void {
  const file = branchSummaryPath(name, cwd);
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, summary, 'utf8');
  fs.renameSync(tmpFile, file);
}

/**
 * Reads a branch's fact set. Returns an empty array (with a warning,
 * matching session.ts's precedent for corrupt files) rather than throwing
 * — a diff or merge walking multiple branches shouldn't crash over one
 * damaged facts.json.
 */
export function readFacts(name: string, cwd: string = process.cwd()): Fact[] {
  const file = branchFactsPath(name, cwd);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Fact[];
  } catch {
    console.error(`brg: ${file} is corrupt, treating branch "${name}" as having no facts`);
    return [];
  }
}

export function writeFacts(name: string, facts: Fact[], cwd: string = process.cwd()): void {
  const file = branchFactsPath(name, cwd);
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(facts, null, 2), 'utf8');
  fs.renameSync(tmpFile, file);
}

/**
 * Reads a branch's checkpoint log, oldest first (log.jsonl is append-only,
 * newest last, per the design doc). Each line is `{ "id": "sha256:..." }`.
 * Blank trailing line from the final newline is skipped. A corrupt line
 * (partial write from a crash mid-append, hand-editing) is skipped with a
 * warning rather than throwing — same tolerance as readFacts/readGitMap,
 * so one bad line can't take down `brg checkout`/`brg log --graph`.
 */
export function readLog(name: string, cwd: string = process.cwd()): string[] {
  const file = branchLogPath(name, cwd);
  if (!fs.existsSync(file)) return [];
  const ids: string[] = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines) {
    try {
      ids.push((JSON.parse(line) as { id: string }).id);
    } catch {
      console.error(`brg: skipping corrupt log line in branch "${name}"`);
    }
  }
  return ids;
}

export function appendLogEntry(name: string, checkpointId: string, cwd: string = process.cwd()): void {
  const file = branchLogPath(name, cwd);
  fs.appendFileSync(file, `${JSON.stringify({ id: checkpointId })}\n`, 'utf8');
}

export function headCheckpoint(name: string, cwd: string = process.cwd()): string | null {
  const log = readLog(name, cwd);
  return log.length > 0 ? log[log.length - 1] : null;
}

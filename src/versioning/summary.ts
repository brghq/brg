import { readLog, writeSummary } from './branches.js';
import { readObject } from './objects.js';
import type { CheckpointObject } from './types.js';

// summary.md is not a source of truth — objects/ + log.jsonl already are,
// durably and completely. So unlike Phase 1's context.md (which needed
// careful append + compact + .bak bookkeeping to avoid losing history it
// alone held), summary.md can be a disposable, fully-regenerated cache:
// recompute it from scratch from the branch's own log every time a
// checkpoint lands. Nothing to corrupt, nothing to lose — worst case it's
// just regenerated again next checkpoint.

const DEFAULT_MAX_CHARS = 20_000;

function formatEntry(object: CheckpointObject): string {
  return object.contextText ?? `- [${object.timestamp}] ${object.tool}: ${object.message}`;
}

/**
 * Rebuilds a branch's summary.md from its checkpoint log, newest
 * checkpoints first until `maxChars` is spent, then writes the result in
 * chronological order (oldest kept entry first) — matching how a rolling
 * log reads naturally. A single checkpoint's own text larger than the
 * whole budget is still kept (truncated to its own tail) rather than
 * dropped entirely, so a fresh branch's first checkpoint is never blank.
 */
export function regenerateSummary(
  branch: string,
  cwd: string = process.cwd(),
  maxChars: number = DEFAULT_MAX_CHARS,
): void {
  const ids = readLog(branch, cwd);
  const kept: string[] = [];
  let total = 0;

  for (let i = ids.length - 1; i >= 0; i--) {
    const object = readObject(ids[i], cwd);
    if (!object) continue;
    const entry = formatEntry(object);
    if (total + entry.length + 1 > maxChars) break;
    kept.unshift(entry);
    total += entry.length + 1;
  }

  if (kept.length === 0 && ids.length > 0) {
    const newest = readObject(ids[ids.length - 1], cwd);
    if (newest) kept.push(formatEntry(newest).slice(-maxChars));
  }

  writeSummary(branch, kept.length > 0 ? `${kept.join('\n')}\n` : '', cwd);
}

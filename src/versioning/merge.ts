import { factKey } from './facts.js';
import type { Fact } from './types.js';

export type ConflictChoice = 'target' | 'source' | 'both';

export interface FactConflict {
  subject: string;
  relation: string;
  targetFacts: Fact[];
  sourceFacts: Fact[];
}

export interface MergeResult {
  merged: Fact[];
  conflicts: FactConflict[];
}

/**
 * Union merge, per the design doc: facts present in only one branch, or
 * identical in both, combine automatically — no LLM call, no resolution
 * needed. A (subject, relation) key present in both branches with a
 * different object on each side is a candidate conflict, held out of
 * `merged` pending resolution (see commands/merge.ts).
 *
 * Pure, no filesystem — same shape as diffFacts, and deliberately not
 * built on top of it: a diff's "removed" entry (only in target) still
 * belongs in a merge's union, which is a different rule than a diff's.
 */
export function mergeFacts(target: Fact[], source: Fact[]): MergeResult {
  const keys = new Set([...target, ...source].map(factKey));
  const merged: Fact[] = [];
  const conflicts: FactConflict[] = [];

  for (const key of keys) {
    const targetFacts = target.filter((f) => factKey(f) === key);
    const sourceFacts = source.filter((f) => factKey(f) === key);
    const targetObjects = new Set(targetFacts.map((f) => f.object));
    const sourceObjects = new Set(sourceFacts.map((f) => f.object));

    const identical = targetFacts.filter((f) => sourceObjects.has(f.object));
    const onlyInTarget = targetFacts.filter((f) => !sourceObjects.has(f.object));
    const onlyInSource = sourceFacts.filter((f) => !targetObjects.has(f.object));

    if (onlyInTarget.length > 0 && onlyInSource.length > 0) {
      merged.push(...identical);
      const [subject, relation] = [
        (targetFacts[0] ?? sourceFacts[0]).subject,
        (targetFacts[0] ?? sourceFacts[0]).relation,
      ];
      conflicts.push({ subject, relation, targetFacts: onlyInTarget, sourceFacts: onlyInSource });
    } else {
      merged.push(...identical, ...onlyInTarget, ...onlyInSource);
    }
  }

  return { merged, conflicts };
}

/**
 * Applies a resolution choice to a conflict, returning the fact(s) to
 * keep. 'both' keeps every fact from both sides for that key — a
 * legitimate outcome (e.g. "provider" supporting multiple values), not
 * treated as still-conflicted.
 */
export function applyConflictChoice(choice: ConflictChoice, conflict: FactConflict): Fact[] {
  if (choice === 'target') return conflict.targetFacts;
  if (choice === 'source') return conflict.sourceFacts;
  return [...conflict.targetFacts, ...conflict.sourceFacts];
}

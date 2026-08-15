import { factKey } from './facts.js';
import type { Fact } from './types.js';

export type FactDiffKind = 'added' | 'removed' | 'changed';

export interface FactDiffEntry {
  kind: FactDiffKind;
  subject: string;
  relation: string;
  // `changed` means the same (subject, relation) exists on both sides
  // with different object(s) — a candidate conflict per the design doc.
  // `object` is populated for added/removed; `from`/`to` for changed.
  object?: string;
  from?: string[];
  to?: string[];
}

/**
 * Pure structural diff between two fact sets — no filesystem, no branch
 * concept, no LLM calls. Callers (the `brg diff` command today, `brg
 * merge`'s conflict detection later) pass in whatever two fact arrays they
 * want compared; this function doesn't care where they came from.
 *
 * - A (subject, relation, object) triple only on one side is `added` or
 *   `removed`.
 * - A (subject, relation) key present on both sides with a different set
 *   of objects is `changed` — this is the same conflict-key logic the
 *   merge engine (module 4) will reuse for candidate-conflict detection.
 */
export function diffFacts(a: Fact[], b: Fact[]): FactDiffEntry[] {
  const entries: FactDiffEntry[] = [];
  const keys = new Set([...a, ...b].map(factKey));

  for (const key of keys) {
    const objectsA = a.filter((f) => factKey(f) === key).map((f) => f.object);
    const objectsB = b.filter((f) => factKey(f) === key).map((f) => f.object);
    const setA = new Set(objectsA);
    const setB = new Set(objectsB);

    const added = objectsB.filter((o) => !setA.has(o));
    const removed = objectsA.filter((o) => !setB.has(o));

    if (added.length === 0 && removed.length === 0) continue;

    const [subject, relation] = splitKey(key, a, b);

    if (added.length > 0 && removed.length > 0) {
      entries.push({ kind: 'changed', subject, relation, from: removed, to: added });
    } else {
      for (const object of removed) {
        entries.push({ kind: 'removed', subject, relation, object });
      }
      for (const object of added) {
        entries.push({ kind: 'added', subject, relation, object });
      }
    }
  }

  return entries.sort((x, y) => (x.subject + x.relation).localeCompare(y.subject + y.relation));
}

function splitKey(key: string, a: Fact[], b: Fact[]): [string, string] {
  const match = a.find((f) => factKey(f) === key) ?? b.find((f) => factKey(f) === key);
  return match ? [match.subject, match.relation] : ['', ''];
}

import type { FactOp } from '../versioning/types.js';

// Parses a tool's response to the combined summary+facts instruction
// (see ai-assisted.ts). Models don't always follow a JSON-only
// instruction exactly — they sometimes wrap the answer in a markdown code
// fence, or add a stray sentence before/after — so this is deliberately
// tolerant rather than a strict JSON.parse. Returns null when the
// response can't be confidently understood as the expected shape, so the
// caller can fall back to treating the raw text as a plain summary
// instead of losing the checkpoint entirely.

export interface ParsedSummaryWithFacts {
  summary: string;
  facts: FactOp[];
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function isValidFactOp(value: unknown): value is FactOp {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.op === 'add' || v.op === 'remove') &&
    typeof v.subject === 'string' &&
    v.subject.trim().length > 0 &&
    typeof v.relation === 'string' &&
    v.relation.trim().length > 0 &&
    typeof v.object === 'string' &&
    v.object.trim().length > 0
  );
}

export function parseSummaryWithFacts(raw: string): ParsedSummaryWithFacts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.summary !== 'string' || obj.summary.trim().length === 0) return null;

  // Invalid individual entries are dropped, not treated as a reason to
  // reject the whole response — a malformed 4th fact shouldn't cost the
  // 3 good ones.
  const facts = Array.isArray(obj.facts) ? obj.facts.filter(isValidFactOp) : [];

  return { summary: obj.summary, facts };
}

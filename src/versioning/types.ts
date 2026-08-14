// Data model for Phase 2 context versioning. See ../../docs/CONTEXT_VERSIONING.md
// for the full design this implements.

export type FactOpKind = 'add' | 'remove';

export interface FactOp {
  op: FactOpKind;
  subject: string;
  relation: string;
  object: string;
}

export type CheckpointSource = 'tool-summary' | 'transcript-extract' | 'manual';

// A checkpoint has either `parent` (normal checkpoint, single lineage) or
// `parents` (merge checkpoint, two lineages) — never both populated.
// Kept as two optional fields rather than a union so callers can read
// `checkpoint.parent ?? checkpoint.parents?.[0] ?? null` without a type
// guard when they only care about "some prior checkpoint."
export interface CheckpointObject {
  id: string;
  parent: string | null;
  parents?: [string, string];
  branch: string;
  tool: string;
  timestamp: string;
  message: string;
  facts_delta: FactOp[];
  source: CheckpointSource;
}

// Everything in CheckpointObject except `id` — the input to hashing and to
// object creation, since `id` is derived from this shape, not chosen by
// the caller.
export type CheckpointObjectInput = Omit<CheckpointObject, 'id'>;

// `confidence` is deliberately a plain string, not an enum: the
// confidence/provenance model is an open decision (see design doc) and
// pinning a fixed set of values now would force a breaking schema change
// later once that's resolved.
export interface Fact {
  subject: string;
  relation: string;
  object: string;
  checkpoint: string;
  confidence: string;
}

export interface GitMapEntry {
  git_branch: string;
  created_from_sha: string;
}

export type GitMap = Record<string, GitMapEntry>;

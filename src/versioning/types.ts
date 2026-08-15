// Data model for Phase 2 context versioning. See ../../docs/CONTEXT_VERSIONING.md
// for the full design this implements.

export type FactOpKind = 'add' | 'remove';

export interface FactOp {
  op: FactOpKind;
  subject: string;
  relation: string;
  object: string;
}

// 'mcp-agent': facts pushed directly by an MCP-connected agent's own
// context_commit call (its own live understanding, not brg retrospectively
// asking a tool to guess) — see mcp/tools.ts's contextCommit.
export type CheckpointSource = 'tool-summary' | 'transcript-extract' | 'manual' | 'mcp-agent';

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
  // The full generated text for this checkpoint (a context strategy's
  // output — tool self-summary, transcript excerpt, or a plain formatted
  // line), when one was generated. This is what branches/<name>/summary.md
  // is regenerated from; `message` alone is too short to be useful as a
  // handoff summary. Absent for checkpoints that never went through a
  // context strategy (e.g. an MCP context_commit call, or a merge
  // checkpoint) — regeneration falls back to formatting `message` itself
  // for those.
  contextText?: string;
  // Reference-only git metadata, per the "context branch vs git branch"
  // spec: the working tree's dirty file paths at checkpoint time (paths
  // only — never diff content or file contents, git already owns those)
  // and the git HEAD sha at that moment, for cross-linking to git history
  // on demand. Both optional/absent outside a git repo, or when nothing
  // was dirty. Never used to resolve context — that's always the active
  // brg branch, regardless of what these say.
  files_touched?: string[];
  git_commit_at_checkpoint?: string | null;
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

import { getActiveBranch } from '../versioning/active.js';
import { branchExists, headCheckpoint, readFacts, readIntent, readLog, readSummary } from '../versioning/branches.js';
import { recordCheckpoint, recordMergeCheckpoint } from '../versioning/checkpoint.js';
import { diffFacts, type FactDiffEntry } from '../versioning/diff.js';
import { applyConflictChoice, mergeFacts, type ConflictChoice, type FactConflict } from '../versioning/merge.js';
import { readObject } from '../versioning/objects.js';
import type { FactOp } from '../versioning/types.js';

// Pure request/response logic for the MCP server's four tools — no MCP
// SDK types here, so this is testable directly without spinning up a
// stdio transport. commands/mcp.ts is the only place that wires these to
// the SDK's tool registration. Every function returns `{ error: string }`
// on failure instead of throwing, matching the MCP contract that a tool
// call reports failure as data in its result, not a thrown exception.

const RECENT_CHECKPOINTS = 5;

export interface ContextSearchInput {
  branch?: string;
  query?: string;
}

export interface ContextSearchResult {
  branch: string;
  intent: string;
  summary: string;
  facts: { subject: string; relation: string; object: string }[];
  recentCheckpoints: { id: string; tool: string; message: string; timestamp: string }[];
}

function resolveBranch(requested: string | undefined, cwd: string): string | { error: string } {
  const branch = requested ?? getActiveBranch(cwd);
  if (!branch) return { error: 'no active branch, and none was specified — pass `branch`, or run "brg branch"/"brg checkout" first' };
  if (!branchExists(branch, cwd)) return { error: `no brg context tracked for branch "${branch}"` };
  return branch;
}

export function contextSearch(
  input: ContextSearchInput,
  cwd: string = process.cwd(),
): ContextSearchResult | { error: string } {
  const branch = resolveBranch(input.branch, cwd);
  if (typeof branch !== 'string') return branch;

  const facts = readFacts(branch, cwd);
  const query = input.query?.trim().toLowerCase();
  const filteredFacts = query
    ? facts.filter((f) => `${f.subject} ${f.relation} ${f.object}`.toLowerCase().includes(query))
    : facts;

  const recentCheckpoints = readLog(branch, cwd)
    .slice(-RECENT_CHECKPOINTS)
    .reverse()
    .map((id) => readObject(id, cwd))
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .map((o) => ({ id: o.id, tool: o.tool, message: o.message, timestamp: o.timestamp }));

  return {
    branch,
    intent: readIntent(branch, cwd).trim(),
    summary: readSummary(branch, cwd).trim(),
    facts: filteredFacts.map(({ subject, relation, object }) => ({ subject, relation, object })),
    recentCheckpoints,
  };
}

export interface ContextCommitInput {
  message: string;
  branch?: string;
  tool?: string;
  // Lets the calling agent record its own understanding directly — its
  // own live reasoning about what changed in this session — instead of
  // brg retrospectively asking a tool to guess (which is what
  // core/checkpoint.ts's performCheckpoint does for brg checkpoint/brg
  // switch). This is the "push" fact-extraction path; that one is the
  // "pull"/reliable path. Both write through the same recordCheckpoint.
  facts?: FactOp[];
}

export interface ContextCommitResult {
  checkpointId: string;
  branch: string;
}

export function contextCommit(
  input: ContextCommitInput,
  cwd: string = process.cwd(),
): ContextCommitResult | { error: string } {
  const branch = resolveBranch(input.branch, cwd);
  if (typeof branch !== 'string') return branch;

  const facts = input.facts ?? [];
  const source = facts.length > 0 ? 'mcp-agent' : 'manual';
  const checkpoint = recordCheckpoint(branch, input.tool ?? 'mcp', input.message, facts, source, undefined, cwd);
  return { checkpointId: checkpoint.id, branch };
}

export interface ContextDiffInput {
  branchA: string;
  branchB: string;
}

export interface ContextDiffResult {
  branchA: string;
  branchB: string;
  differences: FactDiffEntry[];
}

export function contextDiff(
  input: ContextDiffInput,
  cwd: string = process.cwd(),
): ContextDiffResult | { error: string } {
  for (const name of [input.branchA, input.branchB]) {
    if (!branchExists(name, cwd)) return { error: `no brg context tracked for branch "${name}"` };
  }
  const differences = diffFacts(readFacts(input.branchA, cwd), readFacts(input.branchB, cwd));
  return { branchA: input.branchA, branchB: input.branchB, differences };
}

export interface MergeResolutionInput {
  subject: string;
  relation: string;
  choice: ConflictChoice;
}

export interface ContextMergeInput {
  source: string;
  target?: string;
  resolutions?: MergeResolutionInput[];
  tool?: string;
}

export interface ContextMergeConflict {
  subject: string;
  relation: string;
  target: string[];
  source: string[];
}

export type ContextMergeResult =
  | { status: 'merged'; checkpointId: string; target: string }
  | { status: 'conflicts'; conflicts: ContextMergeConflict[] }
  | { error: string };

function conflictKey(subject: string, relation: string): string {
  return `${subject} ${relation}`;
}

/**
 * Attempts a merge and reports conflicts as data rather than resolving
 * them itself — there's no terminal on the other end of an MCP call to
 * prompt interactively, unlike `brg merge`. Auto-merges anything with no
 * conflict; anything with a real conflict not covered by `resolutions` is
 * left uncommitted and returned in `conflicts`, so the calling agent can
 * decide (asking its own user, or reasoning on its own) and call this
 * again with `resolutions` filled in to finish the merge.
 */
export function contextMerge(input: ContextMergeInput, cwd: string = process.cwd()): ContextMergeResult {
  const target = resolveBranch(input.target, cwd);
  if (typeof target !== 'string') return target;
  if (!branchExists(input.source, cwd)) return { error: `no brg context tracked for branch "${input.source}"` };
  if (target === input.source) return { error: 'cannot merge a branch into itself' };
  if (!headCheckpoint(target, cwd) || !headCheckpoint(input.source, cwd)) {
    return { error: 'both branches need at least one checkpoint before merging' };
  }

  const { merged, conflicts } = mergeFacts(readFacts(target, cwd), readFacts(input.source, cwd));

  const resolutions = new Map(
    (input.resolutions ?? []).map((r) => [conflictKey(r.subject, r.relation), r.choice]),
  );
  const unresolved: FactConflict[] = [];
  const resolvedFacts = [...merged];

  for (const conflict of conflicts) {
    const choice = resolutions.get(conflictKey(conflict.subject, conflict.relation));
    if (!choice) {
      unresolved.push(conflict);
      continue;
    }
    resolvedFacts.push(...applyConflictChoice(choice, conflict));
  }

  if (unresolved.length > 0) {
    return {
      status: 'conflicts',
      conflicts: unresolved.map((c) => ({
        subject: c.subject,
        relation: c.relation,
        target: c.targetFacts.map((f) => f.object),
        source: c.sourceFacts.map((f) => f.object),
      })),
    };
  }

  const checkpoint = recordMergeCheckpoint(
    target,
    input.source,
    input.tool ?? 'mcp',
    `merged "${input.source}" into "${target}"`,
    resolvedFacts,
    cwd,
  );
  return { status: 'merged', checkpointId: checkpoint.id, target };
}

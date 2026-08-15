import { appendLogEntry, headCheckpoint, readFacts, writeFacts } from './branches.js';
import { applyFactsDelta, computeFactsDelta } from './facts.js';
import { changedFiles, currentGitSha } from './git.js';
import { writeObject } from './objects.js';
import { regenerateSummary } from './summary.js';
import type { CheckpointObject, CheckpointSource, Fact, FactOp } from './types.js';

/**
 * Records one versioning checkpoint on a branch: writes the content-
 * addressed checkpoint object (parented to that branch's current head),
 * applies its facts_delta to the branch's fact set, appends it to the
 * branch's log, and regenerates summary.md from the (now updated) log.
 * This is the single write path every caller (`brg checkout`'s
 * create-branch path, `brg merge`, `brg checkpoint`, `brg switch`'s
 * auto-checkpoint, and `brg mcp`'s context_commit) goes through, so
 * branch head / facts.json / log.jsonl / summary.md can never drift out
 * of sync with each other.
 */
export function recordCheckpoint(
  branch: string,
  tool: string,
  message: string,
  factsDelta: FactOp[],
  source: CheckpointSource,
  contextText?: string,
  cwd: string = process.cwd(),
): CheckpointObject {
  const parent = headCheckpoint(branch, cwd);
  const object = writeObject(
    {
      parent,
      branch,
      tool,
      timestamp: new Date().toISOString(),
      message,
      facts_delta: factsDelta,
      source,
      contextText,
      files_touched: changedFiles(cwd),
      git_commit_at_checkpoint: currentGitSha(cwd),
    },
    cwd,
  );

  const facts = readFacts(branch, cwd);
  writeFacts(branch, applyFactsDelta(facts, factsDelta, object.id), cwd);
  appendLogEntry(branch, object.id, cwd);
  regenerateSummary(branch, cwd);

  return object;
}

/**
 * Records a merge checkpoint: a two-parent checkpoint object (per the
 * design doc's `parents: [idA, idB]` extension) on `targetBranch`,
 * carrying the facts_delta that transforms its pre-merge fact set into
 * `mergedFacts` — so the merge's history entry reflects what actually
 * changed, not a dump of the whole post-merge state. Both branches must
 * already have at least one checkpoint (a merge needs real parent ids to
 * point at); throws otherwise rather than silently merging into an empty
 * lineage.
 */
export function recordMergeCheckpoint(
  targetBranch: string,
  sourceBranch: string,
  tool: string,
  message: string,
  mergedFacts: Fact[],
  cwd: string = process.cwd(),
): CheckpointObject {
  const targetHead = headCheckpoint(targetBranch, cwd);
  const sourceHead = headCheckpoint(sourceBranch, cwd);
  if (!targetHead || !sourceHead) {
    throw new Error(
      `both "${targetBranch}" and "${sourceBranch}" need at least one checkpoint before they can be merged`,
    );
  }

  const factsDelta = computeFactsDelta(readFacts(targetBranch, cwd), mergedFacts);

  const object = writeObject(
    {
      parent: null,
      parents: [targetHead, sourceHead],
      branch: targetBranch,
      tool,
      timestamp: new Date().toISOString(),
      message,
      facts_delta: factsDelta,
      source: 'manual',
      files_touched: changedFiles(cwd),
      git_commit_at_checkpoint: currentGitSha(cwd),
    },
    cwd,
  );

  writeFacts(targetBranch, mergedFacts, cwd);
  appendLogEntry(targetBranch, object.id, cwd);
  regenerateSummary(targetBranch, cwd);

  return object;
}

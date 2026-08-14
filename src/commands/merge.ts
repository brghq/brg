import readline from 'node:readline/promises';
import { getActiveBranch } from '../versioning/active.js';
import { branchExists, headCheckpoint, readFacts } from '../versioning/branches.js';
import { recordMergeCheckpoint } from '../versioning/checkpoint.js';
import { applyConflictChoice, mergeFacts, type ConflictChoice, type FactConflict } from '../versioning/merge.js';
import { getAdapter } from '../tools/registry.js';
import { readConfig } from '../core/config.js';
import { amber, bold, dim } from '../utils/style.js';
import type { Fact } from '../versioning/types.js';

export interface MergeOptions {
  auto?: boolean;
}

// Both resolvers are injectable so tests can drive conflict resolution
// deterministically, without mocking stdin or shelling out to a real
// tool CLI. mergeCommand's default wiring is the only place that talks
// to readline / the tool registry.
export interface MergeDependencies {
  resolveConflict?: (conflict: FactConflict) => Promise<ConflictChoice>;
  resolveViaArbiter?: (conflict: FactConflict) => Promise<ConflictChoice | null>;
}

async function askConflictInteractive(conflict: FactConflict): Promise<ConflictChoice> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n${bold('Conflict:')} ${conflict.subject} ${conflict.relation}`);
    console.log(`  target: ${conflict.targetFacts.map((f) => f.object).join(', ')}`);
    console.log(`  source: ${conflict.sourceFacts.map((f) => f.object).join(', ')}`);
    let answer = '';
    while (!['t', 's', 'b'].includes(answer)) {
      answer = (await rl.question('Keep [t]arget, [s]ource, or [b]oth? ')).trim().toLowerCase();
    }
    return answer === 't' ? 'target' : answer === 's' ? 'source' : 'both';
  } finally {
    rl.close();
  }
}

// LLM-arbiter, opt-in via --auto. Reuses ToolAdapter.summarizeViaSelf —
// never throws by that interface's own contract, so unavailability here
// (no active tool, no such method, a bad/unparseable reply) all fall
// through to `null`, which mergeCommand treats as "ask the human instead."
async function askArbiterViaActiveTool(conflict: FactConflict): Promise<ConflictChoice | null> {
  const toolName = readConfig().defaultTool;
  const adapter = toolName ? getAdapter(toolName) : undefined;
  if (!adapter?.summarizeViaSelf) return null;

  const instruction =
    `Merge conflict for "${conflict.subject} ${conflict.relation}": ` +
    `target branch says "${conflict.targetFacts.map((f) => f.object).join(', ')}", ` +
    `source branch says "${conflict.sourceFacts.map((f) => f.object).join(', ')}". ` +
    'Reply with exactly one word: target, source, or both.';

  const response = await adapter.summarizeViaSelf(instruction);
  const word = response?.trim().toLowerCase().split(/\s+/)[0];
  return word === 'target' || word === 'source' || word === 'both' ? word : null;
}

/**
 * Merges `source`'s brg context into the currently active brg branch
 * (see versioning/active.ts — not necessarily the checked-out git
 * branch, since a brg branch can exist with no git branch of its own) —
 * context-only, no `git merge` involved (run that yourself if you're also
 * merging code). Union merges automatically; candidate conflicts (same
 * subject+relation, different object on each side) go through
 * `deps.resolveConflict` (interactive by default), or
 * `deps.resolveViaArbiter` first if --auto is passed and the active tool
 * supports it.
 */
export async function mergeCommand(
  source: string,
  options: MergeOptions,
  deps: MergeDependencies = {},
): Promise<void> {
  const resolveConflict = deps.resolveConflict ?? askConflictInteractive;
  const resolveViaArbiter = deps.resolveViaArbiter ?? askArbiterViaActiveTool;

  const target = getActiveBranch();
  if (!target || !branchExists(target)) {
    console.error('brg: no active branch — run "brg branch" or "brg checkout" first.');
    process.exitCode = 1;
    return;
  }
  if (!branchExists(source)) {
    console.error(`brg: no brg context tracked for branch "${source}".`);
    process.exitCode = 1;
    return;
  }
  if (target === source) {
    console.error('brg: cannot merge a branch into itself.');
    process.exitCode = 1;
    return;
  }
  if (!headCheckpoint(target) || !headCheckpoint(source)) {
    console.error('brg: both branches need at least one checkpoint before merging.');
    process.exitCode = 1;
    return;
  }

  const { merged, conflicts } = mergeFacts(readFacts(target), readFacts(source));

  const resolvedFacts: Fact[] = [...merged];
  for (const conflict of conflicts) {
    let choice: ConflictChoice | null = options.auto ? await resolveViaArbiter(conflict) : null;
    if (!choice && options.auto) {
      console.log(
        dim(`(arbiter unavailable for "${conflict.subject} ${conflict.relation}" — asking you instead)`),
      );
    }
    if (!choice) {
      choice = await resolveConflict(conflict);
    }
    resolvedFacts.push(...applyConflictChoice(choice, conflict));
  }

  const toolName = readConfig().defaultTool ?? 'unknown';
  const checkpoint = recordMergeCheckpoint(
    target,
    source,
    toolName,
    `merged "${source}" into "${target}"`,
    resolvedFacts,
  );

  console.log(`${amber('✓')} Merged "${source}" into "${target}" (${checkpoint.id})`);
  if (conflicts.length > 0) {
    console.log(dim(`${conflicts.length} conflict(s) resolved.`));
  }
}

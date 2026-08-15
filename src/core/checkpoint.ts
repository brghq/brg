import { readConfig } from './config.js';
import { manual } from '../context-strategies/manual.js';
import { aiAssisted } from '../context-strategies/ai-assisted.js';
import { getActiveBranch } from '../versioning/active.js';
import { readFacts } from '../versioning/branches.js';
import { recordCheckpoint } from '../versioning/checkpoint.js';
import type { ContextStrategy } from '../context-strategies/types.js';
import type { ToolAdapter } from '../tools/types.js';
import type { CheckpointObject } from '../versioning/types.js';

const strategies: Record<string, ContextStrategy> = {
  manual,
  'ai-assisted': aiAssisted,
};

function activeStrategy(cwd: string): ContextStrategy {
  const { contextStrategy } = readConfig(cwd);
  return strategies[contextStrategy] ?? manual;
}

/**
 * Generates a checkpoint's context text (and, when the active strategy
 * can produce them, structured facts) via the active strategy — see
 * context-strategies/ — and records it on the currently active brg
 * branch. This is the single path both the explicit `brg checkpoint`
 * command and `brg switch`'s auto-checkpoint go through, so both stay in
 * sync.
 *
 * This is the "reliable" fact-extraction path (the other is `brg mcp`'s
 * `context_commit`, which lets an MCP-connected agent push facts
 * directly instead of brg retrospectively asking the tool to guess) —
 * this one fires unconditionally at every checkpoint boundary
 * (`brg checkpoint`, `brg switch`, the plugin's `PreCompact` hook),
 * regardless of whether any agent chose to call an MCP tool. Only the
 * `ai-assisted` strategy's tier 1 actually extracts facts (it's the only
 * tier that makes a live model call); `manual` and ai-assisted's tiers
 * 2/3 always come back with an empty facts_delta — see ai-assisted.ts.
 *
 * Throws if there's no active branch — unreachable in normal use, since
 * `brg init` always seeds one; the caller (checkpointCommand/switchCommand)
 * already gates on `isInitialized()` before this runs.
 */
export async function performCheckpoint(
  message: string,
  tool: ToolAdapter,
  cwd: string = process.cwd(),
): Promise<CheckpointObject> {
  const branch = getActiveBranch(cwd);
  if (!branch) {
    throw new Error('no active brg branch — run "brg init" first');
  }

  const strategy = activeStrategy(cwd);
  const existingFacts = readFacts(branch, cwd);
  const { text, source, factsDelta } = await strategy.generate(message, tool, existingFacts);

  return recordCheckpoint(branch, tool.name, message, factsDelta, source, text, cwd);
}

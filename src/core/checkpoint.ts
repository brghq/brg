import { readConfig } from './config.js';
import { manual } from '../context-strategies/manual.js';
import { aiAssisted } from '../context-strategies/ai-assisted.js';
import { getActiveBranch } from '../versioning/active.js';
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
 * Generates a checkpoint's context text via the active strategy (tiered
 * self-summary/transcript/manual fallback — see context-strategies/) and
 * records it on the currently active brg branch. This is the single path
 * both the explicit `brg checkpoint` command and `brg switch`'s
 * auto-checkpoint go through, so both stay in sync.
 *
 * facts_delta is always empty here — structured fact extraction is a
 * separate, later, LLM-driven addition (see design doc). The generated
 * text is still valuable on its own: it's what branches/<name>/summary.md
 * gets regenerated from (see versioning/summary.ts), which is what
 * `brg switch`/`brg status`/`brg context show` read.
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
  const { text, source } = await strategy.generate(message, tool);

  return recordCheckpoint(branch, tool.name, message, [], source, text, cwd);
}

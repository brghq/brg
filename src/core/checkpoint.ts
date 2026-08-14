import { appendCheckpoint } from './context.js';
import { writeSession, type SessionRecord } from './session.js';
import type { ToolAdapter } from '../tools/types.js';
import { getActiveBranch } from '../versioning/active.js';
import { recordCheckpoint } from '../versioning/checkpoint.js';

/**
 * Writes a checkpoint's context.md line and session record together, and
 * also records it on the versioning side (the currently active brg
 * branch — see versioning/active.ts) so `brg diff`/`brg merge`/`brg log
 * --graph` have real history to work with. facts_delta is always empty
 * here: structured fact extraction (per the design doc) is incremental
 * and LLM-driven, a separate later addition — this just guarantees every
 * branch has a real checkpoint chain in the meantime.
 *
 * The versioning write is best-effort and never blocks the primary
 * checkpoint: if there's no active branch (only reachable via manual
 * .brg/refs/active tampering, since `brg init` always seeds one), it's
 * skipped rather than failing the command.
 *
 * Shared by the explicit `brg checkpoint` command and switch.ts's
 * auto-checkpoint-before-handoff, so both stay in sync with one code path.
 */
export async function performCheckpoint(
  message: string,
  tool: ToolAdapter,
  cwd: string = process.cwd(),
): Promise<SessionRecord> {
  const contextSnapshot = await appendCheckpoint(message, tool, cwd);
  const record: SessionRecord = {
    timestamp: new Date().toISOString(),
    tool: tool.name,
    message,
    contextSnapshot,
  };
  writeSession(record, cwd);

  const activeBranch = getActiveBranch(cwd);
  if (activeBranch) {
    recordCheckpoint(activeBranch, tool.name, message, [], 'manual', cwd);
  }

  return record;
}

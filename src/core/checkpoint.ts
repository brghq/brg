import { appendCheckpoint } from './context.js';
import { writeSession, type SessionRecord } from './session.js';
import type { ToolAdapter } from '../tools/types.js';

/**
 * Writes a checkpoint's context.md line and session record together.
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
  return record;
}

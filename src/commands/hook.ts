import { readConfig } from '../core/config.js';
import { performCheckpoint } from '../core/checkpoint.js';
import { getAdapter } from '../tools/registry.js';
import { getActiveBranch } from '../versioning/active.js';
import { readSummary } from '../versioning/branches.js';

// Backing commands for the Claude Code plugin's hooks (plugin/hooks/hooks.json)
// — `brg hook session-start` / `brg hook pre-compact`. Kept as plain `brg`
// subcommands rather than plugin-bundled scripts so the plugin stays a thin
// wrapper: it just points hooks.json at the already-installed `brg` binary,
// with all the actual logic (and its tests) living here like every other
// command.

// Injectable so tests never touch real process.stdin — in the real hook
// invocation Claude Code pipes JSON and closes stdin quickly, but a test
// runner's stdin is neither a TTY nor closed, so reading it for real could
// hang indefinitely. Same DI pattern already used in branch.ts/merge.ts.
export interface HookDependencies {
  readStdin?: () => Promise<string>;
}

async function defaultReadStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface SessionStartInput {
  source?: 'startup' | 'resume' | 'clear' | 'compact' | string;
}

function printSessionStartContext(text: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
    }),
  );
}

/**
 * SessionStart hook: injects the active branch's summary.md as additional
 * context for the new session, in the JSON shape Claude Code expects.
 * Skips injection (silently, exit 0) when there's no active branch, no
 * summary content yet, or the session started via `/clear` — a user who
 * just asked for a fresh slate shouldn't have old context pushed back in
 * against their explicit intent.
 */
export async function sessionStartHookCommand(deps: HookDependencies = {}): Promise<void> {
  const readStdin = deps.readStdin ?? defaultReadStdin;

  let input: SessionStartInput = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) input = JSON.parse(raw) as SessionStartInput;
  } catch {
    // Malformed/absent stdin — proceed as if no input was given.
  }

  if (input.source === 'clear') return;

  const branch = getActiveBranch();
  if (!branch) return;

  const summary = readSummary(branch).trim();
  if (!summary) return;

  printSessionStartContext(summary);
}

/**
 * PreCompact hook: checkpoints the current session just before Claude
 * Code compacts its context, so nothing gets lost in the compaction.
 * Never blocks compaction — any failure (no active branch, checkpoint
 * generation error) is swallowed and this exits 0 regardless, same
 * "never block the primary flow" posture as `brg switch`'s own
 * auto-checkpoint.
 */
export async function preCompactHookCommand(deps: HookDependencies = {}): Promise<void> {
  const readStdin = deps.readStdin ?? defaultReadStdin;

  try {
    await readStdin(); // drain stdin; trigger/reason aren't currently used
  } catch {
    // ignore
  }

  try {
    if (!getActiveBranch()) return;
    const toolName = readConfig().defaultTool ?? 'claude';
    const tool = getAdapter(toolName) ?? getAdapter('claude');
    if (!tool) return;
    await performCheckpoint('auto-checkpoint before context compaction', tool);
  } catch {
    // Never block compaction over a checkpoint failure.
  }
}

const HANDLERS: Record<string, (deps: HookDependencies) => Promise<void>> = {
  'session-start': sessionStartHookCommand,
  'pre-compact': preCompactHookCommand,
};

export async function hookCommand(event: string, deps: HookDependencies = {}): Promise<void> {
  const handler = HANDLERS[event];
  if (!handler) {
    console.error(`brg: unknown hook event "${event}". Known events: ${Object.keys(HANDLERS).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  await handler(deps);
}

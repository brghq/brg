import { getAdapter, listAdapters } from '../tools/registry.js';
import { readContextForHandoff } from '../core/context.js';
import { performCheckpoint } from '../core/checkpoint.js';
import { isInitialized, readConfig, writeConfig } from '../core/config.js';
import { dim } from '../utils/style.js';

export interface SwitchOptions {
  fresh?: boolean;
}

export async function switchCommand(toolName: string, options: SwitchOptions): Promise<void> {
  const tool = getAdapter(toolName);
  if (!tool) {
    const known = listAdapters().map((a) => a.name).join(', ');
    console.error(`brg: unknown tool "${toolName}". Known tools: ${known}`);
    process.exitCode = 1;
    return;
  }

  if (!tool.isInstalled()) {
    console.error(`brg: ${tool.displayName} is not installed. Run "brg setup" first.`);
    process.exitCode = 1;
    return;
  }

  if (!options.fresh && isInitialized()) {
    await autoCheckpointBeforeSwitch(tool.displayName);
  }

  const contextText =
    !options.fresh && isInitialized() ? readContextForHandoff() || undefined : undefined;

  if (!options.fresh && isInitialized() && !contextText) {
    console.log(dim('(no context.md content yet — starting with an empty context)'));
  }

  if (isInitialized()) {
    writeConfig({ ...readConfig(), defaultTool: tool.name });
  }

  tool.launch(contextText);
}

// Captures whatever the previously-active tool was doing before handing off,
// so the user never has to remember to `brg checkpoint` right before a
// forced switch. Pulls from config's `defaultTool` — the explicit "which
// tool is currently active" record that every switch updates — not from
// the last checkpoint's tool. Using the last checkpoint would misattribute:
// after a Claude -> Codex auto-checkpoint (recorded under "claude", the
// tool being left), the newest session record still says "claude" even
// once Codex is the one actually active, so a later Codex -> Claude switch
// would wrongly re-checkpoint against Claude instead of Codex. Never blocks
// the switch itself — a failure here is logged and swallowed.
async function autoCheckpointBeforeSwitch(destinationDisplayName: string): Promise<void> {
  try {
    const activeToolName = readConfig().defaultTool;
    const sourceAdapter = activeToolName ? getAdapter(activeToolName) : undefined;
    if (!sourceAdapter) return;
    await performCheckpoint(`auto-checkpoint before switching to ${destinationDisplayName}`, sourceAdapter);
  } catch (err) {
    console.error(dim(`brg: auto-checkpoint failed, continuing anyway (${(err as Error).message})`));
  }
}

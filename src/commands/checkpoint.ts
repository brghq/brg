import { performCheckpoint } from '../core/checkpoint.js';
import { readConfig } from '../core/config.js';
import { getAdapter } from '../tools/registry.js';
import { isInitialized } from '../core/config.js';
import type { ToolAdapter } from '../tools/types.js';
import { amber } from '../utils/style.js';

export interface CheckpointOptions {
  tool?: string;
}

// Used only when --tool names something not in the registry (e.g. a tool
// the user hasn't added an adapter for yet) — the context strategy only
// needs a name to label the checkpoint line.
function unregisteredToolStub(name: string): ToolAdapter {
  return {
    name,
    displayName: name,
    isInstalled: () => false,
    install: async () => {},
    isLoggedIn: () => false,
    login: async () => {},
    launch: () => {},
  };
}

export async function checkpointCommand(message: string, options: CheckpointOptions): Promise<void> {
  if (!isInitialized()) {
    console.error('brg: no .brg/ directory found. Run "brg init" first.');
    process.exitCode = 1;
    return;
  }

  const toolName = options.tool ?? readConfig().defaultTool ?? 'unknown';
  const adapter = getAdapter(toolName) ?? unregisteredToolStub(toolName);

  await performCheckpoint(message, adapter);

  console.log(`${amber('✓')} Checkpoint saved.`);
}

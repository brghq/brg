import { getAdapter, listAdapters } from '../tools/registry.js';
import { readContext } from '../core/context.js';
import { isInitialized } from '../core/config.js';
import { dim } from '../utils/style.js';

export interface SwitchOptions {
  fresh?: boolean;
}

export function switchCommand(toolName: string, options: SwitchOptions): void {
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

  const contextText =
    !options.fresh && isInitialized() ? readContext() || undefined : undefined;

  if (!options.fresh && isInitialized() && !contextText) {
    console.log(dim('(no context.md content yet — starting with an empty context)'));
  }

  tool.launch(contextText);
}

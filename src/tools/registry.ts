import type { ToolAdapter } from './types.js';
import { claude } from './claude.js';
import { codex } from './codex.js';

// Adding a new supported AI CLI means adding one adapter file in this
// directory and registering it here — nothing outside src/tools/ changes.
const adapters: ToolAdapter[] = [claude, codex];

export function listAdapters(): ToolAdapter[] {
  return adapters;
}

export function getAdapter(name: string): ToolAdapter | undefined {
  return adapters.find((a) => a.name === name);
}

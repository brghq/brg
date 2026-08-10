import type { ToolAdapter } from './types.js';
import { claude } from './claude.js';
import { gemini } from './gemini.js';
import { codex } from './codex.js';
import { opencode } from './opencode.js';

// Adding a new supported AI CLI means adding one adapter file in this
// directory and registering it here — nothing outside src/tools/ changes.
const adapters: ToolAdapter[] = [claude, gemini, codex, opencode];

export function listAdapters(): ToolAdapter[] {
  return adapters;
}

export function getAdapter(name: string): ToolAdapter | undefined {
  return adapters.find((a) => a.name === name);
}

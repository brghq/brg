import fs from 'node:fs';
import path from 'node:path';
import { brgDir, readConfig } from './config.js';
import type { ToolAdapter } from '../tools/types.js';
import type { ContextStrategy } from '../context-strategies/types.js';
import { manual } from '../context-strategies/manual.js';
import { aiAssisted } from '../context-strategies/ai-assisted.js';

const strategies: Record<string, ContextStrategy> = {
  manual,
  'ai-assisted': aiAssisted,
};

function activeStrategy(cwd: string): ContextStrategy {
  const { contextStrategy } = readConfig(cwd);
  return strategies[contextStrategy] ?? manual;
}

export function contextPath(cwd: string = process.cwd()): string {
  return path.join(brgDir(cwd), 'context.md');
}

export function readContext(cwd: string = process.cwd()): string {
  const file = contextPath(cwd);
  if (!fs.existsSync(file)) {
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * Generates the checkpoint line via the active context strategy and appends
 * it to context.md. Returns the line that was appended (used as the
 * session record's contextSnapshot).
 */
export async function appendCheckpoint(
  userMessage: string,
  tool: ToolAdapter,
  cwd: string = process.cwd(),
): Promise<string> {
  const strategy = activeStrategy(cwd);
  const line = await strategy.generate(userMessage, tool);
  const file = contextPath(cwd);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${existing}${separator}${line}\n`, 'utf8');
  return line;
}

export function initContext(cwd: string = process.cwd()): void {
  const file = contextPath(cwd);
  if (fs.existsSync(file)) {
    return;
  }
  const header = '# Project Context\n\nRolling summary — what\'s been done, key decisions, open threads.\n\n';
  fs.writeFileSync(file, header, 'utf8');
}

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

// Once context.md exceeds this size, older checkpoint entries get rolled
// into a single summary line so the file — and what gets injected into a
// tool's initial prompt — stays bounded as a project's history grows.
const MAX_CONTEXT_BYTES = 50_000;
const KEEP_RECENT_ENTRIES = 20;

// Separate, smaller cap applied only to the copy handed to a tool at
// handoff time (`switch.ts`) — `context show` and the file on disk stay
// untruncated; this only bounds what gets injected as an initial prompt.
const MAX_HANDOFF_CHARS = 20_000;

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
 * Same content as `readContext`, but capped to the most recent
 * MAX_HANDOFF_CHARS for injection into a tool's initial prompt. The file
 * on disk (and `brg context show`) is never truncated — only what gets
 * handed off.
 */
export function readContextForHandoff(cwd: string = process.cwd()): string {
  const content = readContext(cwd);
  if (content.length <= MAX_HANDOFF_CHARS) {
    return content;
  }
  const trimmed = content.slice(content.length - MAX_HANDOFF_CHARS);
  return `[earlier context truncated]\n${trimmed}`;
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
  compactIfNeeded(cwd);
  return line;
}

interface ParsedEntries {
  header: string;
  entries: string[];
}

// A checkpoint entry starts with a line like "- [<timestamp>] tool: ...";
// entries from the ai-assisted strategy can span multiple lines (transcript
// excerpts), so every following line that doesn't start a new entry is
// treated as a continuation of the current one.
function parseEntries(content: string): ParsedEntries {
  const lines = content.split('\n');
  const headerLines: string[] = [];
  const entries: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith('- [')) {
      if (current) entries.push(current.join('\n'));
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      headerLines.push(line);
    }
  }
  if (current) entries.push(current.join('\n'));

  return { header: headerLines.join('\n'), entries };
}

function entryTimestamp(entry: string): string {
  const match = entry.match(/^- \[([^\]]+)\]/);
  return match ? match[1] : 'unknown';
}

/**
 * Rolls checkpoint entries older than the most recent KEEP_RECENT_ENTRIES
 * into a single summary line once context.md exceeds MAX_CONTEXT_BYTES.
 * Rule-based only — no AI call, so it can never fail for the same reason a
 * checkpoint might. Writes via temp-file + rename and keeps a `.bak` of the
 * pre-compaction file so a bad pass can't destroy history irrecoverably.
 */
export function compactIfNeeded(cwd: string = process.cwd()): void {
  const file = contextPath(cwd);
  if (!fs.existsSync(file)) return;

  const content = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(content, 'utf8') <= MAX_CONTEXT_BYTES) return;

  const { header, entries } = parseEntries(content);
  if (entries.length <= KEEP_RECENT_ENTRIES) return;

  const dropped = entries.slice(0, entries.length - KEEP_RECENT_ENTRIES);
  const kept = entries.slice(entries.length - KEEP_RECENT_ENTRIES);
  const throughTimestamp = entryTimestamp(dropped[dropped.length - 1]);

  const summaryLine = `- [compacted through ${throughTimestamp}] ${dropped.length} earlier checkpoint(s) omitted — see .brg/context.md.bak or .brg/sessions/ for full history`;

  fs.copyFileSync(file, `${file}.bak`);

  const headerBlock = header.length > 0 ? `${header.replace(/\n+$/, '')}\n\n` : '';
  const newContent = `${headerBlock}${summaryLine}\n${kept.join('\n')}\n`;

  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, newContent, 'utf8');
  fs.renameSync(tmpFile, file);
}

export function initContext(cwd: string = process.cwd()): void {
  const file = contextPath(cwd);
  if (fs.existsSync(file)) {
    return;
  }
  const header = '# Project Context\n\nRolling summary — what\'s been done, key decisions, open threads.\n\n';
  fs.writeFileSync(file, header, 'utf8');
}

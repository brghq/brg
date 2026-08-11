import fs from 'node:fs';
import path from 'node:path';
import type { TranscriptExtract } from '../tools/types.js';

/**
 * Recursively finds the most recently modified file with the given
 * extension under `rootDir`. If `predicate` is given, candidates are
 * checked newest-first and the first one it accepts wins — used to scope
 * to a specific project's session when a tool's transcripts aren't already
 * partitioned by cwd on disk. Returns null if the directory doesn't exist
 * or no matching file is found — never throws.
 */
export function findMostRecentFile(
  rootDir: string,
  extension: string,
  predicate?: (filePath: string) => boolean,
): string | null {
  const candidates: { file: string; mtimeMs: number }[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        try {
          candidates.push({ file: full, mtimeMs: fs.statSync(full).mtimeMs });
        } catch {
          // skip unreadable file
        }
      }
    }
  }

  walk(rootDir);
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const candidate of candidates) {
    if (!predicate || predicate(candidate.file)) {
      return candidate.file;
    }
  }
  return null;
}

/**
 * Best-effort JSONL transcript reader. Each line is parsed independently;
 * lines that aren't valid JSON, or don't match a recognized shape, are
 * skipped rather than failing the whole read. Recognizes both on-disk
 * transcript shapes:
 *   - Claude Code: { message: { role, content } }, content a string or an
 *     array of { type: 'text', text } parts.
 *   - Codex:       { type: 'response_item', payload: { type: 'message',
 *     role, content } }, content an array of
 *     { type: 'input_text' | 'output_text', text } parts.
 * Keeps the END of the conversation, not the start — a handoff needs the
 * most recent decisions and state, not the opening prompt. Returns null
 * only if the file itself can't be read.
 */
export function extractTextFromJsonl(filePath: string, maxChars: number): TranscriptExtract | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines: string[] = [];
  for (const rawLine of raw.split('\n')) {
    if (!rawLine.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }

    const line = extractLineText(parsed);
    if (line) lines.push(line);
  }

  const kept: string[] = [];
  let total = 0;
  let truncated = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (total + line.length > maxChars) {
      truncated = true;
      break;
    }
    kept.unshift(line);
    total += line.length;
  }

  return { text: kept.join('\n'), truncated, sourcePath: filePath };
}

function extractLineText(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.message === 'object' && obj.message !== null) {
    return extractRoleContent(obj.message as Record<string, unknown>, ['text']);
  }

  if (
    obj.type === 'response_item' &&
    typeof obj.payload === 'object' &&
    obj.payload !== null &&
    (obj.payload as Record<string, unknown>).type === 'message'
  ) {
    return extractRoleContent(obj.payload as Record<string, unknown>, ['input_text', 'output_text']);
  }

  return null;
}

/** Roles that carry framework/system noise rather than conversation content. */
const NOISE_ROLES = new Set(['developer', 'system']);

function extractRoleContent(container: Record<string, unknown>, textTypes: string[]): string | null {
  const role = container.role;
  const content = container.content;
  if (typeof role !== 'string' || NOISE_ROLES.has(role)) return null;

  let text: string | null = null;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((part): part is { type: string; text: string } => {
        return (
          typeof part === 'object' &&
          part !== null &&
          textTypes.includes((part as Record<string, unknown>).type as string) &&
          typeof (part as Record<string, unknown>).text === 'string'
        );
      })
      .map((part) => part.text)
      .join(' ');
  }

  if (!text || !text.trim()) return null;
  return `${role}: ${text.trim()}`;
}

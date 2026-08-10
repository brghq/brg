import fs from 'node:fs';
import path from 'node:path';
import type { TranscriptExtract } from '../tools/types.js';

/**
 * Recursively finds the most recently modified file with the given
 * extension under `rootDir`. Returns null if the directory doesn't exist
 * or contains no matching files — never throws.
 */
export function findMostRecentFile(rootDir: string, extension: string): string | null {
  let best: { file: string; mtimeMs: number } | null = null;

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
          const mtimeMs = fs.statSync(full).mtimeMs;
          if (!best || mtimeMs > best.mtimeMs) {
            best = { file: full, mtimeMs };
          }
        } catch {
          // skip unreadable file
        }
      }
    }
  }

  walk(rootDir);
  return best ? (best as { file: string; mtimeMs: number }).file : null;
}

/**
 * Best-effort JSONL transcript reader. Each line is parsed independently;
 * lines that aren't valid JSON, or don't match a recognized shape, are
 * skipped rather than failing the whole read. Recognizes the two shapes
 * both Claude Code's and Codex's transcript formats use:
 *   { message: { role, content } }  where content is a string or an
 *   array of { type: 'text', text } parts.
 * Returns null only if the file itself can't be read.
 */
export function extractTextFromJsonl(filePath: string, maxChars: number): TranscriptExtract | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines: string[] = [];
  let total = 0;
  let truncated = false;

  for (const rawLine of raw.split('\n')) {
    if (!rawLine.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }

    const line = extractLineText(parsed);
    if (!line) continue;

    if (total + line.length > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    total += line.length;
  }

  return { text: lines.join('\n'), truncated, sourcePath: filePath };
}

function extractLineText(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const message = (parsed as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null) return null;

  const role = (message as Record<string, unknown>).role;
  const content = (message as Record<string, unknown>).content;
  if (typeof role !== 'string') return null;

  let text: string | null = null;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((part): part is { type: string; text: string } => {
        return (
          typeof part === 'object' &&
          part !== null &&
          (part as Record<string, unknown>).type === 'text' &&
          typeof (part as Record<string, unknown>).text === 'string'
        );
      })
      .map((part) => part.text)
      .join(' ');
  }

  if (!text || !text.trim()) return null;
  return `${role}: ${text.trim()}`;
}

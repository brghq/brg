import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolAdapter } from './types.js';
import { isOnPath, anyPathExists } from '../utils/detect.js';
import { handoff, runInteractive } from '../utils/spawn.js';
import { findMostRecentFile, extractTextFromJsonl } from '../utils/transcript.js';

const MAX_TRANSCRIPT_CHARS = 20_000;

export const codex: ToolAdapter = {
  name: 'codex',
  displayName: 'Codex',

  isInstalled() {
    return isOnPath('codex');
  },

  async install() {
    runInteractive('npm', ['install', '-g', '@openai/codex']);
  },

  isLoggedIn() {
    return anyPathExists(['~/.codex/auth.json', '~/.config/codex/auth.json']);
  },

  async login() {
    runInteractive('codex', ['login']);
  },

  launch(contextText) {
    handoff('codex', contextText ? [contextText] : []);
  },

  getLatestTranscript(cwd) {
    try {
      // Codex sessions are partitioned by date (~/.codex/sessions/YYYY/MM/DD/),
      // not by project, so pick the most recent session file whose own
      // recorded cwd matches this project — otherwise a session from an
      // unrelated repo could leak into this project's context.
      const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
      const file = findMostRecentFile(sessionsRoot, '.jsonl', (f) => sessionMatchesCwd(f, cwd));
      if (!file) return null;
      return extractTextFromJsonl(file, MAX_TRANSCRIPT_CHARS);
    } catch {
      return null;
    }
  },

  async summarizeViaSelf(instruction) {
    try {
      const output = execFileSync('codex', ['exec', 'resume', '--last', instruction], {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30_000,
      })
        .toString()
        .trim();
      return output || null;
    } catch {
      return null;
    }
  },
};

/**
 * Checks a session file's own `session_meta` record (always the first
 * line) for a `cwd` matching this project. `session_meta` also embeds the
 * full system-prompt text inline, which can push that single line to
 * tens of KB, so this only reads a bounded prefix and regex-matches the
 * `cwd` field rather than parsing the whole line as JSON — `cwd` is
 * written before the large fields, so it's reliably within the prefix.
 */
function sessionMatchesCwd(filePath: string, cwd: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return false;
  }
  try {
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const prefix = buffer.toString('utf8', 0, bytesRead);
    if (!/"type"\s*:\s*"session_meta"/.test(prefix)) return false;
    const match = prefix.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!match) return false;
    return JSON.parse(`"${match[1]}"`) === cwd;
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

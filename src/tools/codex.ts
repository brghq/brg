import { execFileSync } from 'node:child_process';
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

  getLatestTranscript(_cwd) {
    try {
      // Codex sessions are partitioned by date (~/.codex/sessions/YYYY/MM/DD/),
      // not by project — unlike Claude Code, there's no per-cwd directory to
      // scope into, so this picks the most recent Codex session process-wide.
      const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
      const file = findMostRecentFile(sessionsRoot, '.jsonl');
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

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { ToolAdapter } from './types.js';
import { isOnPath, anyPathExists } from '../utils/detect.js';
import { handoff, runInteractive } from '../utils/spawn.js';
import { findMostRecentFile, extractTextFromJsonl } from '../utils/transcript.js';

const MAX_TRANSCRIPT_CHARS = 20_000;

export const claude: ToolAdapter = {
  name: 'claude',
  displayName: 'Claude Code',

  isInstalled() {
    return isOnPath('claude');
  },

  async install() {
    runInteractive('npm', ['install', '-g', '@anthropic-ai/claude-code']);
  },

  isLoggedIn() {
    return anyPathExists(['~/.claude/credentials.json', '~/.claude.json']);
  },

  async login() {
    runInteractive('claude', ['login']);
  },

  launch(contextText) {
    handoff('claude', contextText ? [contextText] : []);
  },

  getLatestTranscript(cwd) {
    try {
      // Claude Code stores per-project transcripts under a directory named
      // after the cwd with "/" replaced by "-".
      const projectDir = path.join(
        os.homedir(),
        '.claude',
        'projects',
        cwd.replace(/\//g, '-'),
      );
      const file = findMostRecentFile(projectDir, '.jsonl');
      if (!file) return null;
      return extractTextFromJsonl(file, MAX_TRANSCRIPT_CHARS);
    } catch {
      return null;
    }
  },

  async summarizeViaSelf(instruction) {
    try {
      const output = execFileSync('claude', ['-p', instruction, '--continue'], {
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

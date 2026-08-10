import type { ToolAdapter } from './types.js';
import { isOnPath, anyPathExists } from '../utils/detect.js';
import { handoff, runInteractive } from '../utils/spawn.js';

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
};

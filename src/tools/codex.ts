import type { ToolAdapter } from './types.js';
import { isOnPath, anyPathExists } from '../utils/detect.js';
import { handoff, runInteractive } from '../utils/spawn.js';

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
};

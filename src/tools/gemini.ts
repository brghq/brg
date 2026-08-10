import type { ToolAdapter } from './types.js';
import { isOnPath, anyPathExists } from '../utils/detect.js';
import { handoff, runInteractive } from '../utils/spawn.js';

export const gemini: ToolAdapter = {
  name: 'gemini',
  displayName: 'Gemini CLI',

  isInstalled() {
    return isOnPath('gemini');
  },

  async install() {
    runInteractive('npm', ['install', '-g', '@google/gemini-cli']);
  },

  isLoggedIn() {
    return anyPathExists(['~/.gemini/credentials.json', '~/.config/gemini/credentials.json']);
  },

  async login() {
    runInteractive('gemini', ['auth', 'login']);
  },

  launch(contextText) {
    handoff('gemini', contextText ? [contextText] : []);
  },
};

import type { ToolAdapter } from './types.js';
import { isOnPath, anyPathExists } from '../utils/detect.js';
import { handoff, runInteractive } from '../utils/spawn.js';

export const opencode: ToolAdapter = {
  name: 'opencode',
  displayName: 'OpenCode',

  isInstalled() {
    return isOnPath('opencode');
  },

  async install() {
    runInteractive('npm', ['install', '-g', 'opencode-ai']);
  },

  isLoggedIn() {
    return anyPathExists(['~/.opencode/auth.json', '~/.config/opencode/auth.json']);
  },

  async login() {
    runInteractive('opencode', ['auth', 'login']);
  },

  launch(contextText) {
    handoff('opencode', contextText ? [contextText] : []);
  },
};

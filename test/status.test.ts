import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { statusCommand } from '../src/commands/status.js';
import { initCommand } from '../src/commands/init.js';

describe('brg status', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-status-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not crash on an empty/uninitialized directory', () => {
    expect(() => statusCommand()).not.toThrow();
  });

  it('does not crash once initialized with no checkpoints', () => {
    initCommand();
    expect(() => statusCommand()).not.toThrow();
  });
});

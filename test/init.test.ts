import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCommand } from '../src/commands/init.js';
import { getActiveBranch } from '../src/versioning/active.js';
import { branchExists, readSummary } from '../src/versioning/branches.js';
import { recordCheckpoint } from '../src/versioning/checkpoint.js';

describe('brg init', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-init-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .brg/config.yaml', () => {
    initCommand();

    expect(fs.existsSync(path.join(tmpDir, '.brg'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'config.yaml'))).toBe(true);
  });

  it('is idempotent — running twice does not throw or wipe existing branch data', () => {
    initCommand();
    recordCheckpoint('main', 'claude', 'existing note', [], 'manual');

    expect(() => initCommand()).not.toThrow();

    expect(readSummary('main')).toContain('existing note');
  });

  it('activates a default "main" brg branch, even outside a git repo', () => {
    initCommand();

    expect(getActiveBranch()).toBe('main');
    expect(branchExists('main')).toBe(true);
  });
});

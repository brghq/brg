import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCommand } from '../src/commands/init.js';
import { statusCommand } from '../src/commands/status.js';
import { logCommand } from '../src/commands/log.js';
import { readConfig, configPath } from '../src/core/config.js';

describe('resilience to corrupted on-disk data', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-corrupt-'));
    process.chdir(tmpDir);
    initCommand();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not crash status/log commands when a branch checkpoint object is corrupted', () => {
    const objectsDir = path.join(tmpDir, '.brg', 'objects');
    fs.mkdirSync(objectsDir, { recursive: true });
    fs.writeFileSync(path.join(objectsDir, 'deadbeef.json'), '{ not valid json', 'utf8');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => statusCommand()).not.toThrow();
    expect(() => logCommand()).not.toThrow();
    vi.restoreAllMocks();
  });

  it('does not crash status/log when a branch log.jsonl has a corrupt line', () => {
    const logFile = path.join(tmpDir, '.brg', 'branches', 'main', 'log.jsonl');
    fs.appendFileSync(logFile, 'not json\n');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => statusCommand()).not.toThrow();
    expect(() => logCommand()).not.toThrow();
    vi.restoreAllMocks();
  });

  it('falls back to default config instead of crashing on invalid YAML', () => {
    fs.writeFileSync(configPath(), ':\n  - this is not: [valid yaml', 'utf8');

    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = readConfig();
    warn.mockRestore();

    expect(config.contextStrategy).toBe('ai-assisted');
  });
});

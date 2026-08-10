import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCommand } from '../src/commands/init.js';

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

  it('creates .brg/context.md, config.yaml, and sessions/', () => {
    initCommand();

    expect(fs.existsSync(path.join(tmpDir, '.brg'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'context.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.brg', 'sessions'))).toBe(true);
    expect(fs.statSync(path.join(tmpDir, '.brg', 'sessions')).isDirectory()).toBe(true);
  });

  it('is idempotent — running twice does not throw or wipe existing context', () => {
    initCommand();
    fs.appendFileSync(path.join(tmpDir, '.brg', 'context.md'), '- existing note\n');

    expect(() => initCommand()).not.toThrow();

    const content = fs.readFileSync(path.join(tmpDir, '.brg', 'context.md'), 'utf8');
    expect(content).toContain('existing note');
  });
});

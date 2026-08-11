import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCommand } from '../src/commands/init.js';
import { statusCommand } from '../src/commands/status.js';
import { logCommand } from '../src/commands/log.js';
import { writeSession, listSessions, sessionsDir } from '../src/core/session.js';
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

  it('skips an unparsable session file instead of crashing listSessions', () => {
    writeSession({
      timestamp: '2026-01-01T00:00:00.000Z',
      tool: 'claude',
      message: 'good record',
      contextSnapshot: '- good record',
    });
    fs.writeFileSync(path.join(sessionsDir(), 'broken.json'), '{ not valid json', 'utf8');

    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sessions = listSessions();
    warn.mockRestore();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].message).toBe('good record');
  });

  it('does not crash status/log commands when a session file is corrupted', () => {
    fs.writeFileSync(path.join(sessionsDir(), 'broken.json'), '{ not valid json', 'utf8');
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

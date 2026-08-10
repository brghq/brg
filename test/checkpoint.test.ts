import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCommand } from '../src/commands/init.js';
import { checkpointCommand } from '../src/commands/checkpoint.js';
import { listSessions } from '../src/core/session.js';

describe('brg checkpoint', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-checkpoint-'));
    process.chdir(tmpDir);
    initCommand();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a valid session file with the expected shape', async () => {
    await checkpointCommand('did the thing', { tool: 'claude' });

    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      tool: 'claude',
      message: 'did the thing',
    });
    expect(typeof sessions[0].timestamp).toBe('string');
    expect(typeof sessions[0].contextSnapshot).toBe('string');
    expect(sessions[0].contextSnapshot).toContain('did the thing');
  });

  it('appends the checkpoint line to context.md', async () => {
    await checkpointCommand('second message', { tool: 'gemini' });

    const content = fs.readFileSync(path.join(tmpDir, '.brg', 'context.md'), 'utf8');
    expect(content).toContain('gemini: second message');
  });

  it('errors without crashing when .brg/ does not exist', async () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nouninit-'));
    process.chdir(freshDir);

    await expect(checkpointCommand('no init', {})).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    fs.rmSync(freshDir, { recursive: true, force: true });
  });
});

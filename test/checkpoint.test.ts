import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCommand } from '../src/commands/init.js';
import { checkpointCommand } from '../src/commands/checkpoint.js';
import { writeConfig } from '../src/core/config.js';
import { getActiveBranch, setActiveBranch } from '../src/versioning/active.js';
import { createBranch, headCheckpoint, readLog, readSummary } from '../src/versioning/branches.js';
import { readObject } from '../src/versioning/objects.js';

describe('brg checkpoint', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-checkpoint-'));
    process.chdir(tmpDir);
    initCommand();
    // Force the manual strategy here: these tests exercise checkpoint
    // mechanics, not the ai-assisted tiering — and manual is the only
    // strategy guaranteed not to shell out to a real, possibly-installed-
    // and-authenticated CLI.
    writeConfig({ contextStrategy: 'manual' });
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records a checkpoint object on the active branch with the expected shape', async () => {
    const active = getActiveBranch();
    expect(active).toBe('main');

    await checkpointCommand('did the thing', { tool: 'claude' });

    const head = headCheckpoint(active!);
    expect(head).not.toBeNull();
    const checkpoint = readObject(head!);
    expect(checkpoint).toMatchObject({
      branch: 'main',
      tool: 'claude',
      message: 'did the thing',
      parent: null,
      facts_delta: [],
      source: 'manual',
    });
    expect(typeof checkpoint?.contextText).toBe('string');
    expect(checkpoint?.contextText).toContain('did the thing');
  });

  it('regenerates the branch summary to include the new checkpoint', async () => {
    await checkpointCommand('second message', { tool: 'codex' });

    const content = readSummary('main');
    expect(content).toContain('codex: second message');
  });

  it('errors without crashing when .brg/ does not exist', async () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nouninit-'));
    process.chdir(freshDir);

    await expect(checkpointCommand('no init', {})).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    // Must leave freshDir before removing it — deleting the process's
    // own cwd fails with EBUSY on Windows (POSIX allows it, which is why
    // this only failed in CI on windows-latest).
    process.chdir(tmpDir);
    fs.rmSync(freshDir, { recursive: true, force: true });
  });

  it('two checkpoints in a row chain via parent', async () => {
    await checkpointCommand('first', { tool: 'claude' });
    await checkpointCommand('second', { tool: 'claude' });

    const log = readLog('main');
    expect(log).toHaveLength(2);
    const second = readObject(log[1]);
    expect(second?.parent).toBe(log[0]);
  });

  it('errors cleanly, without crashing, when the active-branch pointer is missing', async () => {
    fs.rmSync(path.join(tmpDir, '.brg', 'refs', 'active'));
    expect(getActiveBranch()).toBeNull();

    await expect(checkpointCommand('did the thing anyway', { tool: 'claude' })).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(readLog('main')).toEqual([]);
  });

  it('records against whichever branch is active, not always "main"', async () => {
    createBranch('feature', 'a feature');
    setActiveBranch('feature');

    await checkpointCommand('feature work', { tool: 'claude' });

    expect(headCheckpoint('feature')).not.toBeNull();
    expect(headCheckpoint('main')).toBeNull();
  });
});

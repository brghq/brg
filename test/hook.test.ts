import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hookCommand, preCompactHookCommand, sessionStartHookCommand } from '../src/commands/hook.js';
import { initCommand } from '../src/commands/init.js';
import { getActiveBranch, setActiveBranch } from '../src/versioning/active.js';
import { headCheckpoint, readLog } from '../src/versioning/branches.js';
import { recordCheckpoint } from '../src/versioning/checkpoint.js';
import { readObject } from '../src/versioning/objects.js';
import { writeConfig } from '../src/core/config.js';

const stdinOf = (value: unknown) => async () => (value === undefined ? '' : JSON.stringify(value));

describe('brg hook session-start', () => {
  let cwd: string;
  let tmpDir: string;
  let logs: string[];

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-hook-'));
    process.chdir(tmpDir);
    initCommand();
    writeConfig({ contextStrategy: 'manual' });
    logs = [];
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function captureStdout<T>(fn: () => Promise<T>): Promise<T> {
    const orig = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = (chunk: string) => {
      logs.push(chunk);
      return true;
    };
    try {
      return await fn();
    } finally {
      process.stdout.write = orig;
    }
  }

  it('prints nothing when there is no active branch', async () => {
    fs.rmSync(path.join(tmpDir, '.brg', 'refs', 'active'));
    expect(getActiveBranch()).toBeNull();

    await captureStdout(() => sessionStartHookCommand({ readStdin: stdinOf(undefined) }));

    expect(logs).toEqual([]);
  });

  it('prints nothing when the active branch has no summary yet', async () => {
    await captureStdout(() => sessionStartHookCommand({ readStdin: stdinOf(undefined) }));
    expect(logs).toEqual([]);
  });

  it('prints the active branch summary as hookSpecificOutput JSON', async () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual', '- [2026-01-01T00:00:00.000Z] claude: did the thing');

    await captureStdout(() => sessionStartHookCommand({ readStdin: stdinOf(undefined) }));

    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('did the thing');
  });

  it('skips injection when source is "clear", even with a real summary', async () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    await captureStdout(() => sessionStartHookCommand({ readStdin: stdinOf({ source: 'clear' }) }));

    expect(logs).toEqual([]);
  });

  it('still injects for source "startup"/"resume"/"compact"', async () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    for (const source of ['startup', 'resume', 'compact']) {
      logs = [];
      await captureStdout(() => sessionStartHookCommand({ readStdin: stdinOf({ source }) }));
      expect(logs).toHaveLength(1);
    }
  });

  it('treats malformed stdin as no input, rather than throwing', async () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    await expect(
      captureStdout(() => sessionStartHookCommand({ readStdin: async () => '{ not valid json' })),
    ).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it('a stdin reader that throws does not crash the hook', async () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    await expect(
      captureStdout(() =>
        sessionStartHookCommand({
          readStdin: async () => {
            throw new Error('boom');
          },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
  });
});

describe('brg hook pre-compact', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-hook-precompact-'));
    process.chdir(tmpDir);
    initCommand();
    writeConfig({ contextStrategy: 'manual' });
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records a checkpoint on the active branch', async () => {
    await preCompactHookCommand({ readStdin: stdinOf(undefined) });

    const head = headCheckpoint('main');
    expect(head).not.toBeNull();
    expect(readObject(head!)?.message).toContain('before context compaction');
  });

  it('attributes the checkpoint to config.defaultTool when set', async () => {
    writeConfig({ contextStrategy: 'manual', defaultTool: 'codex' });

    await preCompactHookCommand({ readStdin: stdinOf(undefined) });

    const head = headCheckpoint('main');
    expect(readObject(head!)?.tool).toBe('codex');
  });

  it('falls back to "claude" when no defaultTool is configured', async () => {
    await preCompactHookCommand({ readStdin: stdinOf(undefined) });

    const head = headCheckpoint('main');
    expect(readObject(head!)?.tool).toBe('claude');
  });

  it('does nothing, without throwing, when there is no active branch', async () => {
    fs.rmSync(path.join(tmpDir, '.brg', 'refs', 'active'));

    await expect(preCompactHookCommand({ readStdin: stdinOf(undefined) })).resolves.toBeUndefined();
    expect(readLog('main')).toEqual([]);
  });

  it('does not throw even if the stdin reader throws', async () => {
    await expect(
      preCompactHookCommand({
        readStdin: async () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toBeUndefined();

    // The checkpoint itself should still succeed — draining stdin failing
    // shouldn't block the actual checkpoint.
    expect(headCheckpoint('main')).not.toBeNull();
  });

  it('records against whichever branch is active, not always "main"', async () => {
    const { createBranch } = await import('../src/versioning/branches.js');
    createBranch('feature', 'a feature');
    setActiveBranch('feature');

    await preCompactHookCommand({ readStdin: stdinOf(undefined) });

    expect(headCheckpoint('feature')).not.toBeNull();
    expect(headCheckpoint('main')).toBeNull();
  });
});

describe('brg hook (dispatcher)', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-hook-dispatch-'));
    process.chdir(tmpDir);
    initCommand();
    // Force manual: this block exercises dispatch, not the ai-assisted
    // tiering, and manual is the only strategy guaranteed not to shell
    // out to a real, possibly-installed CLI.
    writeConfig({ contextStrategy: 'manual' });
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('errors cleanly on an unknown event name', async () => {
    await hookCommand('does-not-exist', { readStdin: stdinOf(undefined) });
    expect(process.exitCode).toBe(1);
  });

  it('dispatches "pre-compact" to preCompactHookCommand', async () => {
    await hookCommand('pre-compact', { readStdin: stdinOf(undefined) });
    expect(headCheckpoint('main')).not.toBeNull();
  });
});

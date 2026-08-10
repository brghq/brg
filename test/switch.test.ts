import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { claudeLaunch, codexLaunch } = vi.hoisted(() => ({
  claudeLaunch: vi.fn(),
  codexLaunch: vi.fn(),
}));

// Mocked so this test never touches the real `claude`/`codex` binaries or
// PATH detection — switchCommand's isInstalled() gate would otherwise fail
// (or worse, in this sandbox, succeed and shell out for real).
vi.mock('../src/tools/registry.js', () => {
  const adapters = [
    {
      name: 'claude',
      displayName: 'Claude Code',
      isInstalled: () => true,
      install: async () => {},
      isLoggedIn: () => true,
      login: async () => {},
      launch: claudeLaunch,
    },
    {
      name: 'codex',
      displayName: 'Codex',
      isInstalled: () => true,
      install: async () => {},
      isLoggedIn: () => true,
      login: async () => {},
      launch: codexLaunch,
    },
  ];
  return {
    listAdapters: () => adapters,
    getAdapter: (name: string) => adapters.find((a) => a.name === name),
  };
});

const { switchCommand } = await import('../src/commands/switch.js');
const { initCommand } = await import('../src/commands/init.js');
const { writeConfig } = await import('../src/core/config.js');
const { writeSession, listSessions } = await import('../src/core/session.js');

describe('brg switch auto-checkpoint', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-switch-'));
    process.chdir(tmpDir);
    initCommand();
    writeConfig({ contextStrategy: 'manual' });
    claudeLaunch.mockClear();
    codexLaunch.mockClear();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-checkpoints against the previously active tool before launching', async () => {
    writeSession({
      timestamp: new Date().toISOString(),
      tool: 'claude',
      message: 'prior work',
      contextSnapshot: '- prior work',
    });

    await switchCommand('codex', {});

    const sessions = listSessions();
    expect(sessions).toHaveLength(2);
    const newest = sessions[sessions.length - 1];
    expect(newest.tool).toBe('claude');
    expect(newest.message).toContain('auto-checkpoint before switching to Codex');
    expect(codexLaunch).toHaveBeenCalledTimes(1);
  });

  it('skips auto-checkpoint on --fresh', async () => {
    writeSession({
      timestamp: new Date().toISOString(),
      tool: 'claude',
      message: 'prior work',
      contextSnapshot: '- prior work',
    });

    await switchCommand('codex', { fresh: true });

    expect(listSessions()).toHaveLength(1);
    expect(codexLaunch).toHaveBeenCalledWith(undefined);
  });

  it('skips auto-checkpoint when there is no prior session to attribute it to', async () => {
    await switchCommand('codex', {});

    expect(listSessions()).toHaveLength(0);
    expect(codexLaunch).toHaveBeenCalledTimes(1);
  });
});

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
const { writeConfig, readConfig } = await import('../src/core/config.js');
const { headCheckpoint, readLog, readSummary } = await import('../src/versioning/branches.js');
const { readObject } = await import('../src/versioning/objects.js');

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
    writeConfig({ contextStrategy: 'manual', defaultTool: 'claude' });

    await switchCommand('codex', {});

    const log = readLog('main');
    expect(log).toHaveLength(1);
    const checkpoint = readObject(log[0]);
    expect(checkpoint?.tool).toBe('claude');
    expect(checkpoint?.message).toContain('auto-checkpoint before switching to Codex');
    expect(codexLaunch).toHaveBeenCalledTimes(1);
    expect(readConfig().defaultTool).toBe('codex');
  });

  it('re-attributes correctly across repeated switches (claude -> codex -> claude)', async () => {
    writeConfig({ contextStrategy: 'manual', defaultTool: 'claude' });

    await switchCommand('codex', {});
    await switchCommand('claude', {});

    const log = readLog('main');
    expect(log).toHaveLength(2);
    const first = readObject(log[0]);
    const second = readObject(log[1]);
    expect(first?.tool).toBe('claude');
    expect(first?.message).toContain('switching to Codex');
    expect(second?.tool).toBe('codex');
    expect(second?.message).toContain('switching to Claude Code');
    expect(readConfig().defaultTool).toBe('claude');
  });

  it('skips auto-checkpoint on --fresh', async () => {
    writeConfig({ contextStrategy: 'manual', defaultTool: 'claude' });

    await switchCommand('codex', { fresh: true });

    expect(readLog('main')).toEqual([]);
    expect(codexLaunch).toHaveBeenCalledWith(undefined);
  });

  it('skips auto-checkpoint when there is no prior active tool to attribute it to', async () => {
    await switchCommand('codex', {});

    expect(readLog('main')).toEqual([]);
    expect(codexLaunch).toHaveBeenCalledTimes(1);
    expect(readConfig().defaultTool).toBe('codex');
  });

  it('auto-checkpoint also records a versioning checkpoint on the active branch', async () => {
    writeConfig({ contextStrategy: 'manual', defaultTool: 'claude' });

    await switchCommand('codex', {});

    const head = headCheckpoint('main');
    expect(head).not.toBeNull();
    expect(readObject(head!)).toMatchObject({ tool: 'claude', source: 'manual' });
  });

  it('--fresh skips the versioning checkpoint too', async () => {
    writeConfig({ contextStrategy: 'manual', defaultTool: 'claude' });

    await switchCommand('codex', { fresh: true });

    expect(readLog('main')).toEqual([]);
  });

  it('hands off the active branch summary as context, not undefined, once one exists', async () => {
    writeConfig({ contextStrategy: 'manual', defaultTool: 'claude' });
    await switchCommand('codex', {});
    codexLaunch.mockClear();

    await switchCommand('claude', {});

    expect(claudeLaunch).toHaveBeenCalledTimes(1);
    const [handoffText] = claudeLaunch.mock.calls[0] as [string | undefined];
    expect(handoffText).toBe(readSummary('main').trim());
    expect(handoffText).toContain('switching to Codex');
  });
});

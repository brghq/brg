import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performCheckpoint } from '../src/core/checkpoint.js';
import { writeConfig } from '../src/core/config.js';
import { initCommand } from '../src/commands/init.js';
import { readFacts } from '../src/versioning/branches.js';
import { readObject } from '../src/versioning/objects.js';
import type { ToolAdapter } from '../src/tools/types.js';

function mockAdapter(overrides: Partial<ToolAdapter> = {}): ToolAdapter {
  return {
    name: 'mock-tool',
    displayName: 'Mock Tool',
    isInstalled: () => true,
    install: async () => {},
    isLoggedIn: () => true,
    login: async () => {},
    launch: () => {},
    ...overrides,
  };
}

describe('performCheckpoint — fact extraction end-to-end (the "reliable" path)', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-checkpoint-facts-'));
    process.chdir(tmpDir);
    initCommand();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('manual strategy never extracts facts, even if the tool could provide them', async () => {
    writeConfig({ contextStrategy: 'manual' });
    const tool = mockAdapter({
      summarizeViaSelf: async () =>
        JSON.stringify({ summary: 's', facts: [{ op: 'add', subject: 's', relation: 'r', object: 'o' }] }),
    });

    const checkpoint = await performCheckpoint('did the thing', tool);

    expect(checkpoint.facts_delta).toEqual([]);
    expect(readFacts('main')).toEqual([]);
  });

  it('ai-assisted strategy extracts facts from a well-formed tool response and stores them on the branch', async () => {
    writeConfig({ contextStrategy: 'ai-assisted' });
    const tool = mockAdapter({
      summarizeViaSelf: async () =>
        JSON.stringify({
          summary: 'chose Stripe over Razorpay',
          facts: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
        }),
    });

    const checkpoint = await performCheckpoint('wrap up payments', tool);

    expect(checkpoint.facts_delta).toEqual([
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ]);
    expect(readObject(checkpoint.id)?.facts_delta).toEqual(checkpoint.facts_delta);
    const facts = readFacts('main');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ subject: 'payments', relation: 'provider', object: 'stripe' });
  });

  it('ai-assisted with a tool that has no summarizeViaSelf still succeeds, with no facts', async () => {
    writeConfig({ contextStrategy: 'ai-assisted' });
    const tool = mockAdapter();

    const checkpoint = await performCheckpoint('did the thing', tool);

    expect(checkpoint.facts_delta).toEqual([]);
  });

  it('a second checkpoint receives the first checkpoint\'s facts as "existing" context', async () => {
    writeConfig({ contextStrategy: 'ai-assisted' });
    let secondCallInstruction = '';
    const tool = mockAdapter({
      summarizeViaSelf: async (instruction) => {
        if (!secondCallInstruction && instruction.includes('Known facts')) {
          secondCallInstruction = instruction;
        }
        return JSON.stringify({
          summary: 's',
          facts: secondCallInstruction ? [] : [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
        });
      },
    });

    await performCheckpoint('first', tool);
    await performCheckpoint('second', tool);

    expect(secondCallInstruction).toContain('payments provider: stripe');
  });

  it('facts persist and accumulate across multiple checkpoints on the same branch', async () => {
    writeConfig({ contextStrategy: 'ai-assisted' });
    let call = 0;
    const tool = mockAdapter({
      summarizeViaSelf: async () => {
        call += 1;
        const facts =
          call === 1
            ? [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }]
            : [{ op: 'add', subject: 'auth', relation: 'method', object: 'oauth' }];
        return JSON.stringify({ summary: `checkpoint ${call}`, facts });
      },
    });

    await performCheckpoint('first', tool);
    await performCheckpoint('second', tool);

    const facts = readFacts('main');
    expect(facts.map((f) => `${f.subject}:${f.object}`).sort()).toEqual(['auth:oauth', 'payments:stripe']);
  });
});

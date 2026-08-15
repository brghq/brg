import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../src/commands/mcp.js';
import { createBranch } from '../src/versioning/branches.js';
import { setActiveBranch } from '../src/versioning/active.js';
import { recordCheckpoint } from '../src/versioning/checkpoint.js';

// Connects a real MCP Client to brg's server over an in-memory transport
// pair, instead of spawning `brg mcp` as a subprocess — proves the actual
// tool registration/JSON-RPC wiring works, not just the pure functions in
// src/mcp/tools.ts that the other test file covers.
async function connectedClient() {
  const server = buildMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (first?.type !== 'text' || typeof first.text !== 'string') {
    throw new Error(`expected a text content block, got: ${JSON.stringify(result)}`);
  }
  return JSON.parse(first.text);
}

describe('brg mcp server (end-to-end over in-memory transport)', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-mcp-server-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists exactly the four documented tools', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'context_commit',
      'context_diff',
      'context_merge',
      'context_search',
    ]);
  });

  it('context_search round-trips through the real JSON-RPC call', async () => {
    createBranch('main', 'Explore payments');
    setActiveBranch('main');
    recordCheckpoint('main', 'claude', 'added stripe', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');

    const { client } = await connectedClient();
    const result = await client.callTool({ name: 'context_search', arguments: {} });

    expect(textOf(result)).toMatchObject({
      branch: 'main',
      intent: 'Explore payments',
      facts: [{ subject: 'payments', relation: 'provider', object: 'stripe' }],
    });
  });

  it('context_commit then context_search shows the new checkpoint', async () => {
    createBranch('main', 'root');
    setActiveBranch('main');

    const { client } = await connectedClient();
    const commitResult = await client.callTool({
      name: 'context_commit',
      arguments: { message: 'did the thing', tool: 'claude' },
    });
    expect(textOf(commitResult)).toMatchObject({ branch: 'main' });

    const searchResult = await client.callTool({ name: 'context_search', arguments: {} });
    const parsed = textOf(searchResult) as { recentCheckpoints: { message: string }[] };
    expect(parsed.recentCheckpoints.map((c) => c.message)).toContain('did the thing');
  });

  it('context_commit with facts pushes structured facts through the real MCP schema (zod) validation', async () => {
    createBranch('main', 'root');
    setActiveBranch('main');

    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'context_commit',
      arguments: {
        message: 'chose stripe',
        facts: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
      },
    });

    expect(textOf(result)).toMatchObject({ branch: 'main' });

    const searchResult = await client.callTool({ name: 'context_search', arguments: {} });
    const parsed = textOf(searchResult) as { facts: { subject: string; relation: string; object: string }[] };
    expect(parsed.facts).toContainEqual({ subject: 'payments', relation: 'provider', object: 'stripe' });
  });

  it('context_commit reports a schema validation error for a malformed facts entry (invalid op)', async () => {
    createBranch('main', 'root');
    setActiveBranch('main');

    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'context_commit',
      arguments: {
        message: 'bad facts',
        facts: [{ op: 'not-a-real-op', subject: 's', relation: 'r', object: 'o' }],
      },
    });

    expect(result.isError).toBe(true);
    // Nothing should have been recorded — validation failed before our
    // handler ever ran.
    const searchResult = await client.callTool({ name: 'context_search', arguments: {} });
    const parsed = textOf(searchResult) as { facts: unknown[] };
    expect(parsed.facts).toEqual([]);
  });

  it('context_commit ignores an attempted branch override over the real MCP wire — always writes to active', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    setActiveBranch('main');

    const { client } = await connectedClient();
    await client.callTool({
      name: 'context_commit',
      // "branch" isn't part of context_commit's schema — confirms the
      // real server (not just the pure function) never targets anything
      // other than the active branch.
      arguments: { message: 'did the thing', branch: 'feature' },
    });

    const searchMain = await client.callTool({ name: 'context_search', arguments: { branch: 'main' } });
    const searchFeature = await client.callTool({ name: 'context_search', arguments: { branch: 'feature' } });
    const mainParsed = textOf(searchMain) as { recentCheckpoints: unknown[] };
    const featureParsed = textOf(searchFeature) as { recentCheckpoints: unknown[] };

    expect(mainParsed.recentCheckpoints).toHaveLength(1);
    expect(featureParsed.recentCheckpoints).toHaveLength(0);
  });

  it('context_diff reports an error over the wire for an unknown branch', async () => {
    createBranch('main', 'root');
    const { client } = await connectedClient();

    const result = await client.callTool({
      name: 'context_diff',
      arguments: { branchA: 'main', branchB: 'ghost' },
    });

    expect(textOf(result)).toMatchObject({ error: expect.stringContaining('ghost') });
  });

  it('context_merge returns conflicts, then a follow-up call with resolutions merges', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    setActiveBranch('main');
    recordCheckpoint('main', 'claude', 'm', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');
    recordCheckpoint('feature', 'claude', 'f', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'razorpay' },
    ], 'manual');

    const { client } = await connectedClient();

    const first = await client.callTool({ name: 'context_merge', arguments: { source: 'feature' } });
    expect(textOf(first)).toMatchObject({ status: 'conflicts' });

    const second = await client.callTool({
      name: 'context_merge',
      arguments: {
        source: 'feature',
        resolutions: [{ subject: 'payments', relation: 'provider', choice: 'source' }],
      },
    });
    expect(textOf(second)).toMatchObject({ status: 'merged' });
  });
});

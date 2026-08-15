import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  buildDashboardGraph,
  buildDashboardStats,
  getCheckpointDetail,
  shortId,
} from '../src/versioning/dashboard.js';
import { createDashboardServer } from '../src/commands/dashboard.js';
import { createBranch } from '../src/versioning/branches.js';
import { setActiveBranch } from '../src/versioning/active.js';
import { recordCheckpoint, recordMergeCheckpoint } from '../src/versioning/checkpoint.js';

describe('versioning/dashboard — shortId', () => {
  it('strips the sha256: prefix and truncates to 10 hex chars', () => {
    expect(shortId('sha256:abcdef0123456789')).toBe('abcdef0123');
  });

  it('handles an id with no prefix gracefully', () => {
    expect(shortId('abcdef0123456789')).toBe('abcdef0123');
  });
});

describe('versioning/dashboard — buildDashboardStats', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-dash-stats-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports zeros and null active branch for a fresh, uninitialized project', () => {
    const stats = buildDashboardStats();
    expect(stats).toEqual({
      branches: 0,
      checkpoints: 0,
      activeBranch: null,
      activeBranchSummaryBytes: 0,
      activeBranchEstimatedTokens: 0,
    });
  });

  it('counts branches and checkpoints across the whole project', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    setActiveBranch('main');
    recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    recordCheckpoint('feature', 'claude', 'f1', [], 'manual');

    const stats = buildDashboardStats();
    expect(stats.branches).toBe(2);
    expect(stats.checkpoints).toBe(2);
    expect(stats.activeBranch).toBe('main');
    expect(stats.activeBranchSummaryBytes).toBeGreaterThan(0);
  });

  it('estimates tokens as roughly bytes/4, an approximation not a real tokenizer count', () => {
    createBranch('main', 'root');
    setActiveBranch('main');
    recordCheckpoint('main', 'claude', 'm1', [], 'manual');

    const stats = buildDashboardStats();
    expect(stats.activeBranchEstimatedTokens).toBe(Math.round(stats.activeBranchSummaryBytes / 4));
  });

  it('estimated tokens is 0 when there is no active branch', () => {
    expect(buildDashboardStats().activeBranchEstimatedTokens).toBe(0);
  });
});

describe('versioning/dashboard — buildDashboardGraph', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-dash-graph-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is empty for a project with no checkpoints', () => {
    expect(buildDashboardGraph()).toEqual({ nodes: [], lanes: [] });
  });

  it('assigns lanes by branch, in order of first appearance', async () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    // Two independent roots (no parent/child relationship) with identical
    // millisecond timestamps have no real ordering signal between them —
    // content-hash ids are deliberately uncorrelated with time. A tiny
    // delay guarantees distinct timestamps here, matching how unlikely
    // this is in real usage (a human running two separate commands).
    await new Promise((resolve) => setTimeout(resolve, 2));
    recordCheckpoint('feature', 'claude', 'f1', [], 'manual');

    const graph = buildDashboardGraph();
    expect(graph.lanes).toEqual(['main', 'feature']);
    expect(graph.nodes.find((n) => n.branch === 'main')?.y).toBe(0);
    expect(graph.nodes.find((n) => n.branch === 'feature')?.y).toBe(1);
  });

  it('assigns x in strict chronological (oldest-first) order', () => {
    createBranch('main', 'root');
    const first = recordCheckpoint('main', 'claude', 'first', [], 'manual');
    const second = recordCheckpoint('main', 'claude', 'second', [], 'manual');

    const graph = buildDashboardGraph();
    const firstNode = graph.nodes.find((n) => n.id === first.id);
    const secondNode = graph.nodes.find((n) => n.id === second.id);
    expect(firstNode!.x).toBeLessThan(secondNode!.x);
  });

  it('every node carries a shortId derived from its full id', () => {
    createBranch('main', 'root');
    const checkpoint = recordCheckpoint('main', 'claude', 'm1', [], 'manual');

    const graph = buildDashboardGraph();
    const node = graph.nodes.find((n) => n.id === checkpoint.id);
    expect(node!.shortId).toBe(shortId(checkpoint.id));
  });
});

describe('versioning/dashboard — getCheckpointDetail', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-dash-detail-'));
    process.chdir(tmpDir);
    createBranch('main', 'root');
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for an unknown id', () => {
    expect(getCheckpointDetail('sha256:doesnotexist')).toBeNull();
  });

  it('returns the checkpoint with its facts_delta as-is', () => {
    const checkpoint = recordCheckpoint('main', 'claude', 'did the thing', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');

    const detail = getCheckpointDetail(checkpoint.id);
    expect(detail).toMatchObject({
      id: checkpoint.id,
      branch: 'main',
      tool: 'claude',
      message: 'did the thing',
      factsDelta: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
    });
  });

  it('a merge checkpoint carries its parents array', () => {
    createBranch('feature', 'a feature');
    const m1 = recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    const f1 = recordCheckpoint('feature', 'claude', 'f1', [], 'manual');
    const merge = recordMergeCheckpoint('main', 'feature', 'claude', 'merged', []);

    const detail = getCheckpointDetail(merge.id);
    expect(detail?.parents).toEqual([m1.id, f1.id]);
  });
});

describe('brg dashboard — real HTTP server', () => {
  let cwd: string;
  let tmpDir: string;
  let server: ReturnType<typeof createDashboardServer>;
  let baseUrl: string;

  beforeEach(async () => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-dash-http-'));
    process.chdir(tmpDir);
    createBranch('main', 'root');
    setActiveBranch('main');

    server = createDashboardServer(tmpDir);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET / serves the HTML page', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('brg dashboard');
  });

  it('GET /api/stats returns real stats as JSON', async () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    const res = await fetch(`${baseUrl}/api/stats`);
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats).toMatchObject({ branches: 1, checkpoints: 1, activeBranch: 'main' });
  });

  it('GET /api/graph returns nodes with lane assignments', async () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    const res = await fetch(`${baseUrl}/api/graph`);
    const graph = await res.json();
    expect(graph.lanes).toEqual(['main']);
    expect(graph.nodes).toHaveLength(1);
  });

  it('GET /api/checkpoint/:id returns the checkpoint detail', async () => {
    const checkpoint = recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    const res = await fetch(`${baseUrl}/api/checkpoint/${encodeURIComponent(checkpoint.id)}`);
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.id).toBe(checkpoint.id);
    expect(detail.message).toBe('did the thing');
  });

  it('GET /api/checkpoint/:id 404s cleanly for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/checkpoint/sha256:doesnotexist`);
    expect(res.status).toBe(404);
  });

  it('unknown routes 404 as JSON', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('non-GET requests are rejected with 405', async () => {
    const res = await fetch(`${baseUrl}/api/stats`, { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('reflects new checkpoints on the next request — no caching, no stale state', async () => {
    const before = await (await fetch(`${baseUrl}/api/stats`)).json();
    expect(before.checkpoints).toBe(0);

    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    const after = await (await fetch(`${baseUrl}/api/stats`)).json();
    expect(after.checkpoints).toBe(1);
  });
});

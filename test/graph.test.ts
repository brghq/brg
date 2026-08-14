import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectGraphNodes, renderGraph, type GraphNode } from '../src/versioning/graph.js';
import { createBranch } from '../src/versioning/branches.js';
import { recordCheckpoint, recordMergeCheckpoint } from '../src/versioning/checkpoint.js';
import { logCommand } from '../src/commands/log.js';
import { initCommand } from '../src/commands/init.js';

const node = (
  id: string,
  parent: string | null,
  branch: string,
  timestamp: string,
  parents?: [string, string],
): GraphNode => ({ id, parent, parents, branch, tool: 'claude', timestamp, message: `msg ${id}` });

describe('versioning/graph — renderGraph', () => {
  it('a single linear branch renders one lane throughout', () => {
    const nodes = [
      node('c', 'b', 'main', '2026-01-01T00:00:02Z'),
      node('b', 'a', 'main', '2026-01-01T00:00:01Z'),
      node('a', null, 'main', '2026-01-01T00:00:00Z'),
    ];
    const lines = renderGraph(nodes);
    expect(lines.map((l) => l.graph)).toEqual(['*', '*', '*']);
    expect(lines.map((l) => l.node?.id)).toEqual(['c', 'b', 'a']);
  });

  it('two independent branches never converge and occupy separate lanes', () => {
    const nodes = [
      node('m2', 'm1', 'main', '2026-01-01T00:00:03Z'),
      node('f2', 'f1', 'feature', '2026-01-01T00:00:02Z'),
      node('m1', null, 'main', '2026-01-01T00:00:01Z'),
      node('f1', null, 'feature', '2026-01-01T00:00:00Z'),
    ];
    const lines = renderGraph(nodes);
    // main's lane (col 0) and feature's lane (col 1) never share a column.
    // Row 4 (f1): main's lane already closed after m1, so column 0 is a
    // genuinely inactive blank, not a "|" — there's no more main history
    // above this point still waiting on anything.
    expect(lines.map((l) => l.graph)).toEqual(['*', '| *', '* |', '  *']);
  });

  it('a merge checkpoint opens a connector line and both parent lineages remain visible', () => {
    const nodes = [
      node('merge', 'm1', 'main', '2026-01-01T00:00:04Z', ['m1', 'f1']),
      node('f1', null, 'feature', '2026-01-01T00:00:02Z'),
      node('m1', null, 'main', '2026-01-01T00:00:01Z'),
    ];
    const lines = renderGraph(nodes);
    expect(lines[0]).toEqual({ graph: '*', node: nodes[0] });
    // connector line: column 0 continues (|), new lane opens at column 1 (\)
    expect(lines[1].graph).toBe('| \\');
    expect(lines[1].node).toBeUndefined();
    // then the two parent lineages render in their own lanes. m1's row
    // has trailing whitespace trimmed off (lane 1 is free to its right).
    const remaining = lines.slice(2).map((l) => [l.graph, l.node?.id]);
    expect(remaining).toContainEqual(['| *', 'f1']);
    expect(remaining).toContainEqual(['*', 'm1']);
  });

  it('empty input renders no lines', () => {
    expect(renderGraph([])).toEqual([]);
  });

  it('a lone root checkpoint with no parent renders as a single closed lane', () => {
    const lines = renderGraph([node('a', null, 'main', '2026-01-01T00:00:00Z')]);
    expect(lines).toEqual([{ graph: '*', node: expect.objectContaining({ id: 'a' }) }]);
  });

  it('ties on identical timestamps still produce a deterministic order', () => {
    const nodes = [
      node('b', null, 'main', '2026-01-01T00:00:00Z'),
      node('a', null, 'main', '2026-01-01T00:00:00Z'),
    ];
    const first = renderGraph(nodes).map((l) => l.node?.id);
    const second = renderGraph(nodes).map((l) => l.node?.id);
    expect(first).toEqual(second);
  });
});

describe('versioning/graph — collectGraphNodes', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-graph-collect-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when there are no branches', () => {
    expect(collectGraphNodes()).toEqual([]);
  });

  it('collects every checkpoint reachable from every branch head', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    const m1 = recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    const f1 = recordCheckpoint('feature', 'claude', 'f1', [], 'manual');

    const ids = collectGraphNodes().map((n) => n.id).sort();
    expect(ids).toEqual([f1.id, m1.id].sort());
  });

  it('includes history from a merged-from branch even after it stops being a listed branch head', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    const m1 = recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    const f1 = recordCheckpoint('feature', 'claude', 'f1', [], 'manual');
    const merge = recordMergeCheckpoint('main', 'feature', 'claude', 'merge', []);

    // Only "main"'s head (the merge commit) is a branch head now, but f1
    // must still be reachable via the merge's parents.
    const ids = collectGraphNodes().map((n) => n.id).sort();
    expect(ids).toEqual([f1.id, m1.id, merge.id].sort());
  });

  it('does not duplicate a checkpoint reachable via two paths', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    recordCheckpoint('feature', 'claude', 'f1', [], 'manual');
    recordMergeCheckpoint('main', 'feature', 'claude', 'merge', []);

    const ids = collectGraphNodes().map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('brg log --graph command', () => {
  let cwd: string;
  let tmpDir: string;
  let logs: string[];

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-log-graph-'));
    process.chdir(tmpDir);
    initCommand();
    logs = [];
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function captureLogs(fn: () => void): void {
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      fn();
    } finally {
      console.log = orig;
    }
  }

  it('prints a placeholder when no checkpoints exist yet', () => {
    captureLogs(() => logCommand({ graph: true }));
    expect(logs.some((l) => l.includes('No branch checkpoints recorded yet'))).toBe(true);
  });

  it('prints one line per checkpoint, including the message', () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');
    captureLogs(() => logCommand({ graph: true }));
    expect(logs.some((l) => l.includes('did the thing'))).toBe(true);
  });

  it('without --graph, falls back to the existing session-based log', () => {
    captureLogs(() => logCommand());
    expect(logs.some((l) => l.includes('No checkpoints yet'))).toBe(true);
  });
});

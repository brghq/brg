import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectBranchNodes, collectGraphNodes, renderGraph, topologicalOrder, type GraphNode } from '../src/versioning/graph.js';
import { createBranch } from '../src/versioning/branches.js';
import { setActiveBranch } from '../src/versioning/active.js';
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

describe('versioning/graph — topologicalOrder', () => {
  it('a parent always appears before its child, even with identical timestamps', () => {
    // 'z' deliberately sorts before 'a' alphabetically, so an id-only
    // tie-break (no topological awareness) would wrongly put the child
    // first — the exact bug this function exists to prevent.
    const parent = node('z-parent', null, 'main', '2026-01-01T00:00:00.000Z');
    const child = node('a-child', 'z-parent', 'main', '2026-01-01T00:00:00.000Z');

    const order = topologicalOrder([child, parent]).map((n) => n.id);
    expect(order).toEqual(['z-parent', 'a-child']);
  });

  it('a merge checkpoint appears after both of its parents, even with identical timestamps', () => {
    const mainRoot = node('z-main', null, 'main', '2026-01-01T00:00:00.000Z');
    const featureRoot = node('z-feature', null, 'feature', '2026-01-01T00:00:00.000Z');
    const merge = node('a-merge', null, 'main', '2026-01-01T00:00:00.000Z', ['z-main', 'z-feature']);

    const order = topologicalOrder([merge, featureRoot, mainRoot]).map((n) => n.id);
    expect(order.indexOf('a-merge')).toBeGreaterThan(order.indexOf('z-main'));
    expect(order.indexOf('a-merge')).toBeGreaterThan(order.indexOf('z-feature'));
  });

  it('independent nodes with distinct timestamps are ordered by timestamp', () => {
    const later = node('a', null, 'main', '2026-01-01T00:00:01.000Z');
    const earlier = node('z', null, 'feature', '2026-01-01T00:00:00.000Z');

    expect(topologicalOrder([later, earlier]).map((n) => n.id)).toEqual(['z', 'a']);
  });

  it('a longer chain (grandparent -> parent -> child) stays in order under identical timestamps', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const grandparent = node('z1', null, 'main', ts);
    const parent = node('m2', 'z1', 'main', ts);
    const child = node('a3', 'm2', 'main', ts);

    const order = topologicalOrder([child, grandparent, parent]).map((n) => n.id);
    expect(order).toEqual(['z1', 'm2', 'a3']);
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

describe('versioning/graph — collectBranchNodes', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-branch-nodes-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is empty for a branch with no checkpoints', () => {
    createBranch('main', 'root');
    expect(collectBranchNodes('main')).toEqual([]);
  });

  it('returns only the given branch\'s own checkpoints, not other branches\'', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    const m1 = recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    recordCheckpoint('feature', 'claude', 'f1', [], 'manual');

    const nodes = collectBranchNodes('main');
    expect(nodes.map((n) => n.id)).toEqual([m1.id]);
  });

  it('a merge checkpoint is included, but the merged-in branch\'s own history is not pulled in', () => {
    createBranch('main', 'root');
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    const f1 = recordCheckpoint('feature', 'claude', 'f1', [], 'manual');
    const merge = recordMergeCheckpoint('main', 'feature', 'claude', 'merged', []);

    const nodes = collectBranchNodes('main');
    expect(nodes.map((n) => n.id)).toContain(merge.id);
    expect(nodes.map((n) => n.id)).not.toContain(f1.id);
    // The merge checkpoint's own parents field is untouched, though —
    // renderGraph can still show the merge shape from it.
    expect(nodes.find((n) => n.id === merge.id)?.parents).toContain(f1.id);
  });
});

describe('brg log command', () => {
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

  describe('--graph', () => {
    it('prints a placeholder when no checkpoints exist yet', () => {
      captureLogs(() => logCommand({ graph: true }));
      expect(logs.some((l) => l.includes('No branch checkpoints recorded yet'))).toBe(true);
    });

    it('prints one line per checkpoint, including the message', () => {
      recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');
      captureLogs(() => logCommand({ graph: true }));
      expect(logs.some((l) => l.includes('did the thing'))).toBe(true);
    });

    it('without --all, only shows the active branch\'s own history, not other branches\'', () => {
      createBranch('feature', 'a feature');
      recordCheckpoint('main', 'claude', 'main work', [], 'manual');
      recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

      captureLogs(() => logCommand({ graph: true }));

      expect(logs.some((l) => l.includes('main work'))).toBe(true);
      expect(logs.some((l) => l.includes('feature work'))).toBe(false);
    });

    it('--all shows every branch\'s history in the graph', () => {
      createBranch('feature', 'a feature');
      recordCheckpoint('main', 'claude', 'main work', [], 'manual');
      recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

      captureLogs(() => logCommand({ graph: true, all: true }));

      expect(logs.some((l) => l.includes('main work'))).toBe(true);
      expect(logs.some((l) => l.includes('feature work'))).toBe(true);
    });
  });

  describe('flat (no --graph)', () => {
    it('default (no flags) shows only the active branch\'s checkpoints', () => {
      createBranch('feature', 'a feature');
      recordCheckpoint('main', 'claude', 'main work', [], 'manual');
      recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

      captureLogs(() => logCommand());

      expect(logs.some((l) => l.includes('main work'))).toBe(true);
      expect(logs.some((l) => l.includes('feature work'))).toBe(false);
    });

    it('prints a placeholder when the active branch has no checkpoints yet', () => {
      captureLogs(() => logCommand());
      expect(logs.some((l) => l.includes('No checkpoints yet'))).toBe(true);
    });

    it('--all shows every branch\'s checkpoints, flat and tagged with branch name', () => {
      createBranch('feature', 'a feature');
      recordCheckpoint('main', 'claude', 'main work', [], 'manual');
      recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

      captureLogs(() => logCommand({ all: true }));

      const mainLine = logs.find((l) => l.includes('main work'));
      const featureLine = logs.find((l) => l.includes('feature work'));
      expect(mainLine).toContain('main');
      expect(featureLine).toContain('feature');
    });

    it('--all interleaves branches by timestamp rather than grouping by branch', async () => {
      createBranch('feature', 'a feature');
      recordCheckpoint('main', 'claude', 'first (main)', [], 'manual');
      await new Promise((resolve) => setTimeout(resolve, 2));
      recordCheckpoint('feature', 'claude', 'second (feature)', [], 'manual');
      await new Promise((resolve) => setTimeout(resolve, 2));
      recordCheckpoint('main', 'claude', 'third (main)', [], 'manual');

      captureLogs(() => logCommand({ all: true }));

      // Newest first: third, second, first.
      const order = logs
        .map((l) => (l.includes('first') ? 0 : l.includes('second') ? 1 : l.includes('third') ? 2 : -1))
        .filter((i) => i !== -1);
      expect(order).toEqual([2, 1, 0]);
    });

    it('switching the active branch changes what the default (no --all) view shows', () => {
      createBranch('feature', 'a feature');
      recordCheckpoint('main', 'claude', 'main work', [], 'manual');
      recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

      setActiveBranch('feature');
      captureLogs(() => logCommand());

      expect(logs.some((l) => l.includes('feature work'))).toBe(true);
      expect(logs.some((l) => l.includes('main work'))).toBe(false);
    });
  });
});

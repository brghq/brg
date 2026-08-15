import { isInitialized } from '../core/config.js';
import { getActiveBranch } from '../versioning/active.js';
import { readObject } from '../versioning/objects.js';
import { readLog } from '../versioning/branches.js';
import { collectBranchNodes, collectGraphNodes, renderGraph, type GraphNode } from '../versioning/graph.js';
import { amber, dim } from '../utils/style.js';

export interface LogOptions {
  graph?: boolean;
  all?: boolean;
}

function shortId(id: string): string {
  const hex = id.includes(':') ? id.split(':', 2)[1] : id;
  return hex.slice(0, 10);
}

function formatNodeLine(graph: string, node: GraphNode): string {
  return `${graph}  ${dim(shortId(node.id))} ${amber(node.branch)} ${node.tool}: ${node.message} ${dim(`(${node.timestamp})`)}`;
}

/**
 * Mirrors `git log`'s default-vs-`--all` behavior:
 * - `brg log` (no flags) — active brg branch only, newest first.
 * - `brg log --all` — every branch's checkpoints together, flat,
 *   interleaved by timestamp (not grouped by branch), each entry tagged
 *   with its source branch.
 * - `brg log --graph` (no `--all`) — active branch's own history only.
 *   A merge checkpoint on it still shows as a merge point, but the
 *   merged-in branch's own history isn't pulled in — that needs `--all`.
 * - `brg log --all --graph` — the full multi-branch graph.
 */
export function logCommand(options: LogOptions = {}): void {
  if (!isInitialized()) {
    console.error('brg: this project hasn\'t been initialized yet. Run "brg init" first.');
    process.exitCode = 1;
    return;
  }

  if (options.graph) {
    logGraph(options.all ?? false);
    return;
  }

  if (options.all) {
    logFlatAll();
  } else {
    logFlatActive();
  }
}

function logFlatActive(): void {
  const branch = getActiveBranch();
  if (!branch) {
    console.log(dim('No active branch.'));
    return;
  }

  const nodes = readLog(branch)
    .map((id) => readObject(id))
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .reverse();

  if (nodes.length === 0) {
    console.log(dim('No checkpoints yet. Run "brg checkpoint <message>" to create one.'));
    return;
  }

  for (const n of nodes) {
    console.log(`${dim(n.timestamp)}  ${amber(n.tool)}  ${n.message}`);
  }
}

function logFlatAll(): void {
  const nodes = collectGraphNodes().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (nodes.length === 0) {
    console.log(dim('No checkpoints yet. Run "brg checkpoint <message>" to create one.'));
    return;
  }

  for (const n of nodes) {
    console.log(`${dim(n.timestamp)}  ${amber(n.branch)}  ${dim(n.tool)}  ${n.message}`);
  }
}

function logGraph(all: boolean): void {
  let nodes: GraphNode[];
  if (all) {
    nodes = collectGraphNodes();
  } else {
    const branch = getActiveBranch();
    if (!branch) {
      console.log(dim('No active branch.'));
      return;
    }
    nodes = collectBranchNodes(branch);
  }

  const lines = renderGraph(nodes);
  if (lines.length === 0) {
    console.log(dim('No branch checkpoints recorded yet.'));
    return;
  }

  for (const line of lines) {
    console.log(line.node ? formatNodeLine(line.graph, line.node) : dim(line.graph));
  }
}

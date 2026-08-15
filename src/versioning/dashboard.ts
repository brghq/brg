import { getActiveBranch } from './active.js';
import { listBranches, readSummary } from './branches.js';
import { collectGraphNodes, topologicalOrder, type GraphNode } from './graph.js';
import { readObject } from './objects.js';
import type { FactOp } from './types.js';

// Data-shaping for `brg dashboard` (commands/dashboard.ts) — pure functions
// only, no HTTP here, so they're testable without spinning up a server.
// Reuses collectGraphNodes (the same walk `brg log --graph` uses) rather
// than a separate read path.

export function shortId(id: string): string {
  const hex = id.includes(':') ? id.split(':', 2)[1] : id;
  return hex.slice(0, 10);
}

export interface DashboardStats {
  branches: number;
  checkpoints: number;
  activeBranch: string | null;
  activeBranchSummaryBytes: number;
  // A rough estimate (chars/4, the common English-text heuristic), not a
  // real tokenizer count — brg has no tokenizer dependency and isn't
  // adding one just for a dashboard stat. Labeled "(est.)" in the UI so
  // it never reads as more precise than it is.
  activeBranchEstimatedTokens: number;
}

export function buildDashboardStats(cwd: string = process.cwd()): DashboardStats {
  const activeBranch = getActiveBranch(cwd);
  const summaryBytes = activeBranch ? Buffer.byteLength(readSummary(activeBranch, cwd), 'utf8') : 0;
  return {
    branches: listBranches(cwd).length,
    checkpoints: collectGraphNodes(cwd).length,
    activeBranch,
    activeBranchSummaryBytes: summaryBytes,
    activeBranchEstimatedTokens: Math.round(summaryBytes / 4),
  };
}

export interface DashboardNode extends GraphNode {
  shortId: string;
  // x: chronological order (0 = oldest). y: which lane (branch) this node
  // renders on — branches are assigned a lane in first-appearance order,
  // oldest checkpoint first, so a graph reads left-to-right, top-to-bottom
  // the same way a project's branches were actually created.
  x: number;
  y: number;
}

export interface DashboardGraph {
  nodes: DashboardNode[];
  lanes: string[];
}

export function buildDashboardGraph(cwd: string = process.cwd()): DashboardGraph {
  const nodes = topologicalOrder(collectGraphNodes(cwd));

  const lanes: string[] = [];
  for (const node of nodes) {
    if (!lanes.includes(node.branch)) lanes.push(node.branch);
  }

  return {
    lanes,
    nodes: nodes.map((node, x) => ({
      ...node,
      shortId: shortId(node.id),
      x,
      y: lanes.indexOf(node.branch),
    })),
  };
}

export interface CheckpointDetail {
  id: string;
  shortId: string;
  branch: string;
  tool: string;
  timestamp: string;
  message: string;
  parent: string | null;
  parents?: [string, string];
  factsDelta: FactOp[];
}

/**
 * A checkpoint's facts_delta already *is* its diff (add/remove ops
 * against its parent's fact set) — no separate diff computation needed,
 * unlike the mockup's merge inspector panel, which this maps onto
 * directly. Always `[]` today since structured fact extraction isn't
 * built yet (see ROADMAP.md); the inspector renders correctly regardless,
 * it just has nothing to show until that lands.
 */
export function getCheckpointDetail(id: string, cwd: string = process.cwd()): CheckpointDetail | null {
  const object = readObject(id, cwd);
  if (!object) return null;
  return {
    id: object.id,
    shortId: shortId(object.id),
    branch: object.branch,
    tool: object.tool,
    timestamp: object.timestamp,
    message: object.message,
    parent: object.parent,
    parents: object.parents,
    factsDelta: object.facts_delta,
  };
}

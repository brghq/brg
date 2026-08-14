import { headCheckpoint, listBranches } from './branches.js';
import { readObject } from './objects.js';

export interface GraphNode {
  id: string;
  parent: string | null;
  parents?: [string, string];
  branch: string;
  tool: string;
  timestamp: string;
  message: string;
}

export interface GraphLine {
  graph: string;
  node?: GraphNode;
}

/**
 * Walks every branch's head backward through parent/parents links,
 * deduping by checkpoint id (a node reachable from two branches — e.g.
 * one already merged into another — is collected once). Includes history
 * from branches that no longer exist too, as long as some surviving
 * checkpoint still points at it as a parent.
 */
export function collectGraphNodes(cwd: string = process.cwd()): GraphNode[] {
  const visited = new Map<string, GraphNode>();
  const queue: string[] = [];

  for (const branch of listBranches(cwd)) {
    const head = headCheckpoint(branch, cwd);
    if (head) queue.push(head);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    const object = readObject(id, cwd);
    if (!object) continue;

    visited.set(id, {
      id: object.id,
      parent: object.parent,
      parents: object.parents,
      branch: object.branch,
      tool: object.tool,
      timestamp: object.timestamp,
      message: object.message,
    });

    if (object.parents) {
      queue.push(object.parents[0], object.parents[1]);
    } else if (object.parent) {
      queue.push(object.parent);
    }
  }

  return [...visited.values()];
}

function newestFirst(nodes: GraphNode[]): GraphNode[] {
  // Checkpoint timestamps are monotonically increasing relative to their
  // own parent(s) — a checkpoint is always created after whatever it's
  // parented to already exists — so sorting purely by timestamp yields a
  // valid topological order (every node appears before its parents).
  // Ties (identical timestamp) break on id for determinism.
  return [...nodes].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
}

function parentsOf(node: GraphNode): string[] {
  if (node.parents) return [node.parents[0], node.parents[1]];
  if (node.parent) return [node.parent];
  return [];
}

// Trailing whitespace (from lanes to the right of the active column all
// being free) is trimmed — it's noise, not signal; leading/internal
// blanks are kept since they mark a genuinely inactive lane between
// active ones.
function rowChars(lanes: (string | null)[], activeColumn: number, marker: string): string {
  return lanes
    .map((id, i) => (i === activeColumn ? marker : id !== null ? '|' : ' '))
    .join(' ')
    .replace(/\s+$/, '');
}

/**
 * Lane-based ASCII graph layout, same family of algorithm as `git log
 * --graph`: each lane is a column awaiting a specific checkpoint id.
 * Simplified relative to git's own (no true diagonal compaction across
 * multiple steps), but exact for the shapes this app actually produces —
 * merges always have exactly two parents, never an octopus merge.
 */
export function renderGraph(input: GraphNode[]): GraphLine[] {
  const nodes = newestFirst(input);
  const lanes: (string | null)[] = [];
  const lines: GraphLine[] = [];

  for (const node of nodes) {
    const matching: number[] = [];
    lanes.forEach((id, i) => {
      if (id === node.id) matching.push(i);
    });

    let column: number;
    if (matching.length > 0) {
      column = matching[0];
      for (const idx of matching.slice(1)) lanes[idx] = null;
    } else {
      const free = lanes.indexOf(null);
      column = free !== -1 ? free : lanes.length;
      if (free === -1) lanes.push(null);
    }

    lines.push({ graph: rowChars(lanes, column, '*'), node });

    const parents = parentsOf(node);
    if (parents.length === 0) {
      lanes[column] = null;
    } else {
      lanes[column] = parents[0];
      if (parents.length > 1) {
        const free = lanes.indexOf(null);
        const newColumn = free !== -1 && free !== column ? free : lanes.length;
        if (free === -1 || free === column) lanes.push(parents[1]);
        else lanes[free] = parents[1];

        const connector = lanes
          .map((id, i) => {
            if (i === newColumn) return newColumn > column ? '\\' : '/';
            return id !== null ? '|' : ' ';
          })
          .join(' ')
          .replace(/\s+$/, '');
        lines.push({ graph: connector });
      }
    }
  }

  return lines;
}

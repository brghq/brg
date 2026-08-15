import { headCheckpoint, listBranches, readLog } from './branches.js';
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

/**
 * A single branch's own checkpoint history — its log.jsonl already *is*
 * the complete, ordered list (every checkpoint on a branch is parented to
 * the previous one on that same branch, or the branch's own head plus an
 * external second parent for a merge checkpoint), so this needs no
 * parent-walk the way `collectGraphNodes` does. A merge checkpoint's
 * second parent (from the merged-in branch) intentionally isn't resolved
 * here — `renderGraph` shows the merge point without pulling in that
 * other branch's full ancestry, matching `brg log --graph` (no `--all`).
 */
export function collectBranchNodes(branch: string, cwd: string = process.cwd()): GraphNode[] {
  return readLog(branch, cwd)
    .map((id) => readObject(id, cwd))
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .map((object) => ({
      id: object.id,
      parent: object.parent,
      parents: object.parents,
      branch: object.branch,
      tool: object.tool,
      timestamp: object.timestamp,
      message: object.message,
    }));
}

/**
 * Oldest-first topological order: every node appears after all of its
 * parents. Plain timestamp sorting gets this right almost always (a
 * checkpoint is always created after whatever it's parented to already
 * exists), but two checkpoints landing in the same millisecond break that
 * — content-hash ids have no relation to causal order, so tie-breaking on
 * id alone can put a child before its own parent. Kahn's algorithm here
 * guarantees correctness regardless of timestamp resolution; timestamp
 * (then id) is only the tie-break among nodes that are simultaneously
 * ready, which keeps ordering intuitive without risking an invalid one.
 */
export function topologicalOrder(input: GraphNode[]): GraphNode[] {
  const byId = new Map(input.map((n) => [n.id, n]));
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const node of input) {
    indegree.set(node.id, indegree.get(node.id) ?? 0);
    for (const parentId of parentsOf(node)) {
      if (!byId.has(parentId)) continue;
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      const siblings = children.get(parentId);
      if (siblings) siblings.push(node.id);
      else children.set(parentId, [node.id]);
    }
  }

  const ready = input.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const compare = (a: GraphNode, b: GraphNode) =>
    a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);
  const queue = [...ready].sort(compare);

  const result: GraphNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const childId of children.get(node.id) ?? []) {
      const remaining = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, remaining);
      if (remaining === 0) {
        const child = byId.get(childId)!;
        const insertAt = queue.findIndex((n) => compare(n, child) > 0);
        if (insertAt === -1) queue.push(child);
        else queue.splice(insertAt, 0, child);
      }
    }
  }

  return result;
}

function newestFirst(nodes: GraphNode[]): GraphNode[] {
  return topologicalOrder(nodes).reverse();
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

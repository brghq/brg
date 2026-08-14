import { listSessions } from '../core/session.js';
import { isInitialized } from '../core/config.js';
import { collectGraphNodes, renderGraph, type GraphNode } from '../versioning/graph.js';
import { amber, dim } from '../utils/style.js';

export interface LogOptions {
  graph?: boolean;
}

export function logCommand(options: LogOptions = {}): void {
  if (!isInitialized()) {
    console.error('brg: this project hasn\'t been initialized yet. Run "brg init" first.');
    process.exitCode = 1;
    return;
  }

  if (options.graph) {
    logGraph();
    return;
  }

  const sessions = listSessions().reverse();
  if (sessions.length === 0) {
    console.log(dim('No checkpoints yet. Run "brg checkpoint <message>" to create one.'));
    return;
  }

  for (const s of sessions) {
    console.log(`${dim(s.timestamp)}  ${amber(s.tool)}  ${s.message}`);
  }
}

function shortId(id: string): string {
  const hex = id.includes(':') ? id.split(':', 2)[1] : id;
  return hex.slice(0, 10);
}

function formatNodeLine(graph: string, node: GraphNode): string {
  return `${graph}  ${dim(shortId(node.id))} ${amber(node.branch)} ${node.tool}: ${node.message} ${dim(`(${node.timestamp})`)}`;
}

function logGraph(): void {
  const lines = renderGraph(collectGraphNodes());
  if (lines.length === 0) {
    console.log(dim('No branch checkpoints recorded yet.'));
    return;
  }

  for (const line of lines) {
    console.log(line.node ? formatNodeLine(line.graph, line.node) : dim(line.graph));
  }
}

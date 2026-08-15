import { branchExists, readFacts, readIntent, readLog } from './branches.js';
import { readObject } from './objects.js';
import { shortId } from './dashboard.js';
import type { Fact, FactOp } from './types.js';

// Data-shaping for `brg export` — pure, no filesystem writes, no format
// rendering. Reuses the same branch/object read path every other brg
// surface uses; no export-specific data path.

export interface ExportEntry {
  id: string;
  shortId: string;
  timestamp: string;
  tool: string;
  message: string;
  factsDelta: FactOp[];
}

export interface ExportData {
  branch: string;
  intent: string;
  entries: ExportEntry[];
  facts: Fact[];
}

export function buildExportData(branch: string, cwd: string = process.cwd()): ExportData | { error: string } {
  if (!branchExists(branch, cwd)) {
    return { error: `no brg context tracked for branch "${branch}"` };
  }

  const entries = readLog(branch, cwd)
    .map((id) => readObject(id, cwd))
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .map((o) => ({
      id: o.id,
      shortId: shortId(o.id),
      timestamp: o.timestamp,
      tool: o.tool,
      message: o.message,
      factsDelta: o.facts_delta,
    }));

  return {
    branch,
    intent: readIntent(branch, cwd).trim(),
    entries,
    facts: readFacts(branch, cwd),
  };
}

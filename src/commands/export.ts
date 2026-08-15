import fs from 'node:fs';
import { getActiveBranch } from '../versioning/active.js';
import { buildDashboardGraph } from '../versioning/dashboard.js';
import { buildExportData } from '../versioning/export.js';
import { renderExportHtml, renderExportMarkdown } from '../versioning/export-render.js';
import { renderGraphSvg } from '../versioning/graph-svg.js';
import { amber } from '../utils/style.js';

export interface ExportOptions {
  branch?: string;
  format?: string;
  out?: string;
}

type ExportFormat = 'md' | 'html';

function resolveFormat(requested: string | undefined): ExportFormat | { error: string } {
  if (!requested || requested === 'md') return 'md';
  if (requested === 'html') return 'html';
  return { error: `unknown format "${requested}" — expected "md" or "html"` };
}

/**
 * Free, local, no-account alternative to cloud sharing: a readable
 * snapshot of a branch's context someone can open without brg installed.
 * Reuses the same data every other brg surface reads — no export-specific
 * data path — and, for HTML, the same graph rendering the dashboard uses.
 * PDF is not generated here; point people at the browser's own
 * print-to-PDF on the HTML export instead (noted in the export itself).
 */
export async function exportCommand(options: ExportOptions): Promise<void> {
  const branch = options.branch ?? getActiveBranch();
  if (!branch) {
    console.error('brg: no active branch — pass --branch, or run "brg branch"/"brg checkout" first.');
    process.exitCode = 1;
    return;
  }

  const format = resolveFormat(options.format);
  if (typeof format !== 'string') {
    console.error(`brg: ${format.error}`);
    process.exitCode = 1;
    return;
  }

  const data = buildExportData(branch);
  if ('error' in data) {
    console.error(`brg: ${data.error}`);
    process.exitCode = 1;
    return;
  }

  const content =
    format === 'html' ? renderExportHtml(data, renderGraphSvg(buildDashboardGraph())) : renderExportMarkdown(data);

  const outPath = options.out ?? `brg-export-${branch}.${format}`;
  fs.writeFileSync(outPath, content, 'utf8');

  console.log(`${amber('✓')} Exported "${branch}" to ${outPath}`);
}

import type { ExportData, ExportEntry } from './export.js';
import type { Fact } from './types.js';

// Two renderers over the same ExportData, per the design doc: Markdown
// (zero dependency, git-diffable) and self-contained HTML (zero
// dependency — the SVG graph is passed in pre-rendered, reusing
// versioning/graph-svg.ts, not recomputed here). PDF is deliberately not
// generated — point people at the browser's own print-to-PDF on the HTML
// export instead.

function formatFactLine(op: 'add' | 'remove', f: { subject: string; relation: string; object: string }): string {
  const sign = op === 'add' ? '+' : '−';
  return `${sign} ${f.subject}: ${f.relation} ${f.object}`;
}

export function renderExportMarkdown(data: ExportData): string {
  const lines: string[] = [];
  lines.push(`# Branch: ${data.branch}`, '');
  lines.push('## Intent', '');
  lines.push(data.intent || '_(no intent recorded)_', '');
  lines.push('## Decision log', '');

  if (data.entries.length === 0) {
    lines.push('_(no checkpoints recorded yet)_', '');
  }
  for (const entry of data.entries) {
    lines.push(`- **${entry.timestamp}** (${entry.tool}) — ${entry.message}`);
    for (const op of entry.factsDelta) {
      lines.push(`  - ${formatFactLine(op.op, op)}`);
    }
  }
  lines.push('');

  lines.push('## Facts', '');
  if (data.facts.length === 0) {
    lines.push('_(no facts recorded yet)_', '');
  } else {
    lines.push('| Subject | Relation | Object | Confidence |', '|---|---|---|---|');
    for (const fact of data.facts) {
      lines.push(`| ${fact.subject} | ${fact.relation} | ${fact.object} | ${fact.confidence} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderEntryHtml(entry: ExportEntry): string {
  const facts = entry.factsDelta
    .map(
      (op) =>
        `<div class="fact-line ${op.op === 'add' ? 'add' : 'remove'}">${escapeHtml(formatFactLine(op.op, op))}</div>`,
    )
    .join('');
  return `<div class="entry">
    <div class="entry-meta">${escapeHtml(entry.timestamp)} · ${escapeHtml(entry.tool)}</div>
    <div class="entry-message">${escapeHtml(entry.message)}</div>
    ${facts}
  </div>`;
}

function renderFactsTableHtml(facts: Fact[]): string {
  if (facts.length === 0) return '<p class="empty">(no facts recorded yet)</p>';
  const rows = facts
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.subject)}</td><td>${escapeHtml(f.relation)}</td><td>${escapeHtml(f.object)}</td><td>${escapeHtml(f.confidence)}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Subject</th><th>Relation</th><th>Object</th><th>Confidence</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderExportHtml(data: ExportData, graphSvg: string): string {
  const entriesHtml =
    data.entries.length > 0
      ? data.entries.map(renderEntryHtml).join('')
      : '<p class="empty">(no checkpoints recorded yet)</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>brg export — ${escapeHtml(data.branch)}</title>
<style>
  :root {
    --paper: #EDE9E0;
    --ink: #1A1815;
    --amber: #C9762F;
    --ink-soft: #55504A;
    --line: #D8D2C4;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 14px;
    line-height: 1.5;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 24px 64px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
  header .logo { width: 28px; height: 28px; border-radius: 7px; flex-shrink: 0; }
  header h1 { font-size: 18px; margin: 0; }
  header .tagline { color: var(--ink-soft); font-size: 12px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-soft); margin: 36px 0 14px; }
  .intent { font-size: 15px; }
  .graph-wrap { border: 1px solid var(--line); border-radius: 6px; overflow-x: auto; padding: 8px; }
  .entry { border-left: 2px solid var(--line); padding: 4px 0 14px 16px; margin-bottom: 4px; }
  .entry-meta { color: var(--ink-soft); font-size: 11px; }
  .entry-message { font-size: 14px; margin: 3px 0 6px; }
  .fact-line { display: inline-block; padding: 3px 8px; border-radius: 4px; margin: 2px 6px 2px 0; font-size: 12px; }
  .fact-line.add { background: #dff2e1; color: #1c5c2b; }
  .fact-line.remove { background: #f6dede; color: #7a2020; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--ink-soft); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .empty { color: var(--ink-soft); }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--ink-soft); font-size: 11px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <svg class="logo" viewBox="0 0 460 460" role="img" aria-label="brg logo">
      <rect width="460" height="460" rx="80" fill="#1A1815"/>
      <circle cx="178" cy="230" r="73" fill="none" stroke="#EDE9E0" stroke-width="22"/>
      <circle cx="280.5" cy="230" r="73.5" fill="#C9762F"/>
    </svg>
    <div>
      <h1>${escapeHtml(data.branch)}</h1>
      <span class="tagline">exported from brg — never explain yourself twice</span>
    </div>
  </header>

  <h2>Intent</h2>
  <p class="intent">${data.intent ? escapeHtml(data.intent) : '<span class="empty">(no intent recorded)</span>'}</p>

  <h2>Branch graph</h2>
  <div class="graph-wrap">${graphSvg}</div>

  <h2>Decision log</h2>
  ${entriesHtml}

  <h2>Facts</h2>
  ${renderFactsTableHtml(data.facts)}

  <footer>Exported by brg. Print this page (Ctrl/Cmd+P) to save as PDF.</footer>
</div>
</body>
</html>
`;
}

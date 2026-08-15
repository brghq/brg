import http from 'node:http';
import { buildDashboardGraph, buildDashboardStats, getCheckpointDetail } from '../versioning/dashboard.js';
import { amber } from '../utils/style.js';

export interface DashboardOptions {
  port?: string;
}

const DEFAULT_PORT = 4848;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sendHtml(res: http.ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * Builds the dashboard's HTTP server without starting it — split out so
 * tests can listen on an ephemeral port (0) and issue real fetch()
 * requests, instead of spawning a real `brg dashboard` process.
 * Read-only: every route reads `.brg/` fresh on each request (no caching,
 * no database, no in-memory state) — a checkpoint recorded from another
 * terminal shows up on the next reload, matching the design doc's "no
 * separate data path" principle for every brg surface.
 */
export function createDashboardServer(cwd: string = process.cwd()): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (url.pathname === '/') {
      sendHtml(res, DASHBOARD_HTML);
      return;
    }

    if (url.pathname === '/api/stats') {
      sendJson(res, 200, buildDashboardStats(cwd));
      return;
    }

    if (url.pathname === '/api/graph') {
      sendJson(res, 200, buildDashboardGraph(cwd));
      return;
    }

    const checkpointMatch = url.pathname.match(/^\/api\/checkpoint\/(.+)$/);
    if (checkpointMatch) {
      const id = decodeURIComponent(checkpointMatch[1]);
      const detail = getCheckpointDetail(id, cwd);
      if (!detail) {
        sendJson(res, 404, { error: `no checkpoint "${id}"` });
        return;
      }
      sendJson(res, 200, detail);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

/**
 * Starts the dashboard and keeps the process alive (like `brg mcp`) until
 * interrupted. No browser auto-open — prints the URL and lets the user
 * open it, keeping this dependency-free.
 */
export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  const port = options.port ? Number(options.port) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`brg: invalid --port "${options.port}"`);
    process.exitCode = 1;
    return;
  }

  const server = createDashboardServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log(`${amber('✓')} Dashboard running at http://localhost:${actualPort} (Ctrl+C to stop)`);
      resolve();
    });
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>brg dashboard</title>
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
    font-variant-numeric: tabular-nums;
  }
  header {
    padding: 18px 24px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    gap: 12px;
  }
  header .logo { width: 28px; height: 28px; border-radius: 7px; flex-shrink: 0; display: block; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; letter-spacing: -0.01em; }
  header .tagline { color: var(--ink-soft); font-size: 12px; }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1px;
    background: var(--line);
    border-bottom: 1px solid var(--line);
  }
  .stat {
    background: var(--paper);
    padding: 18px 22px;
  }
  .stat .value { font-size: 26px; font-weight: 600; letter-spacing: -0.01em; }
  .stat .label { color: var(--ink-soft); font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; margin-top: 5px; }

  main {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 1px;
    background: var(--line);
    min-height: 60vh;
  }
  .panel { background: var(--paper); padding: 22px; overflow: auto; }
  .panel h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-soft); margin: 0 0 18px; font-weight: 600; }

  #graph rect.lane-band { fill: var(--paper); }
  #graph rect.lane-band.odd { fill: #E4E0D5; }
  #graph circle { fill: var(--paper); stroke: var(--amber); stroke-width: 2.5; cursor: pointer; }
  #graph circle.selected { fill: var(--amber); }
  #graph circle:hover { fill: var(--line); }
  #graph circle.selected:hover { fill: var(--amber); }
  #graph path { fill: none; stroke: var(--ink-soft); stroke-width: 1.5; opacity: 0.5; }
  #graph text.lane-label { fill: var(--ink-soft); font-size: 11px; font-weight: 600; }
  #graph text.node-label { fill: var(--ink-soft); font-size: 10px; }

  .empty { color: var(--ink-soft); }

  .checkpoint-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
  .checkpoint-id {
    color: var(--ink-soft);
    font-size: 11px;
    background: var(--line);
    padding: 2px 7px;
    border-radius: 4px;
  }
  .checkpoint-message { font-size: 15px; margin-bottom: 6px; line-height: 1.4; }
  .checkpoint-meta { color: var(--ink-soft); font-size: 11px; margin-bottom: 18px; }

  .fact-line { padding: 7px 10px; border-radius: 4px; margin-bottom: 6px; font-size: 12px; }
  .fact-line.add { background: #dff2e1; color: #1c5c2b; }
  .fact-line.remove { background: #f6dede; color: #7a2020; }

  .hint { color: var(--ink-soft); font-size: 11px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
</style>
</head>
<body>
<header>
  <svg class="logo" viewBox="0 0 460 460" role="img" aria-label="brg logo">
    <rect width="460" height="460" rx="80" fill="#1A1815"/>
    <circle cx="178" cy="230" r="73" fill="none" stroke="#EDE9E0" stroke-width="22"/>
    <circle cx="280.5" cy="230" r="73.5" fill="#C9762F"/>
  </svg>
  <h1>brg dashboard</h1>
  <span class="tagline">never explain yourself twice</span>
</header>
<div class="stats" id="stats"></div>
<main>
  <div class="panel">
    <h2>Branch graph</h2>
    <div id="graph-container"><svg id="graph" width="100%" height="360"></svg></div>
  </div>
  <div class="panel">
    <h2>Checkpoint inspector</h2>
    <div id="inspector"><p class="empty">Click a node in the graph to inspect it.</p></div>
  </div>
</main>
<script>
async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

function formatTokens(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function renderStats(stats) {
  const el = document.getElementById('stats');
  const rows = [
    ['Branches', stats.branches],
    ['Checkpoints', stats.checkpoints],
    ['Active Branch', stats.activeBranch || '(none)'],
    ['Tokens (est.) · Active', formatTokens(stats.activeBranchEstimatedTokens)],
  ];
  el.innerHTML = rows.map(([label, value]) =>
    '<div class="stat"><div class="value">' + value + '</div><div class="label">' + label + '</div></div>'
  ).join('');
}

function renderGraph(graph) {
  const svg = document.getElementById('graph');
  const laneHeight = 70;
  const colWidth = 90;
  const marginLeft = 90;
  const marginTop = 30;
  const height = Math.max(200, graph.lanes.length * laneHeight + marginTop * 2);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + (marginLeft + graph.nodes.length * colWidth + 40) + ' ' + height);

  const posOf = (id) => {
    const n = graph.nodes.find((n) => n.id === id);
    return n ? { x: marginLeft + n.x * colWidth, y: marginTop + n.y * laneHeight } : null;
  };

  const totalWidth = marginLeft + graph.nodes.length * colWidth + 40;
  let svgContent = '';

  graph.lanes.forEach((lane, i) => {
    const y = marginTop + i * laneHeight;
    const bandClass = i % 2 === 1 ? 'lane-band odd' : 'lane-band';
    svgContent += '<rect class="' + bandClass + '" x="0" y="' + (y - laneHeight / 2) + '" width="' + totalWidth + '" height="' + laneHeight + '"></rect>';
  });
  graph.lanes.forEach((lane, i) => {
    const y = marginTop + i * laneHeight;
    svgContent += '<text class="lane-label" x="0" y="' + (y + 4) + '">' + lane + '</text>';
  });

  for (const node of graph.nodes) {
    const to = posOf(node.id);
    if (!to) continue;
    const parents = node.parents ? node.parents : node.parent ? [node.parent] : [];
    for (const parentId of parents) {
      const from = posOf(parentId);
      if (!from) continue;
      const midX = (from.x + to.x) / 2;
      svgContent += '<path d="M' + from.x + ',' + from.y + ' C ' + midX + ',' + from.y + ' ' + midX + ',' + to.y + ' ' + to.x + ',' + to.y + '" />';
    }
  }

  for (const node of graph.nodes) {
    const p = posOf(node.id);
    if (!p) continue;
    svgContent += '<circle data-id="' + node.id + '" cx="' + p.x + '" cy="' + p.y + '" r="7"></circle>';
    svgContent += '<text class="node-label" x="' + p.x + '" y="' + (p.y - 14) + '" text-anchor="middle">' + node.shortId + '</text>';
  }

  svg.innerHTML = svgContent;

  svg.querySelectorAll('circle').forEach((circle) => {
    circle.addEventListener('click', () => {
      svg.querySelectorAll('circle').forEach((c) => c.classList.remove('selected'));
      circle.classList.add('selected');
      showCheckpoint(circle.getAttribute('data-id'));
    });
  });
}

async function showCheckpoint(id) {
  const detail = await fetchJson('/api/checkpoint/' + encodeURIComponent(id));
  const el = document.getElementById('inspector');
  if (detail.error) {
    el.innerHTML = '<p class="empty">' + detail.error + '</p>';
    return;
  }

  const facts = detail.factsDelta.map((f) =>
    '<div class="fact-line ' + (f.op === 'add' ? 'add' : 'remove') + '">' +
    (f.op === 'add' ? '+ ' : '− ') + f.subject + ': ' + f.relation + ' ' + f.object +
    '</div>'
  ).join('');

  el.innerHTML =
    '<div class="checkpoint-header"><span class="checkpoint-id">#' + detail.shortId + '</span></div>' +
    '<div class="checkpoint-message">' + detail.message + '</div>' +
    '<div class="checkpoint-meta">' + detail.branch + ' · ' + detail.tool + ' · ' + detail.timestamp + '</div>' +
    (facts || '<p class="empty">No structured facts on this checkpoint yet.</p>') +
    '<div class="hint">checkpoint #' + detail.shortId + ' · click another node to compare</div>';
}

async function init() {
  const [stats, graph] = await Promise.all([fetchJson('/api/stats'), fetchJson('/api/graph')]);
  renderStats(stats);
  if (graph.nodes.length === 0) {
    document.getElementById('graph-container').innerHTML = '<p class="empty">No checkpoints recorded yet.</p>';
    return;
  }
  renderGraph(graph);
}

init();
</script>
</body>
</html>
`;

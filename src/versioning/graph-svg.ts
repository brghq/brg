import type { DashboardGraph } from './dashboard.js';

// Server-side rendering of a DashboardGraph as a standalone SVG string —
// the single place this layout is computed. `brg dashboard` fetches it
// (GET /api/graph.svg) and layers click handlers on top of the returned
// markup; `brg export --format html` embeds the same markup inline. One
// rendering, two consumers — matches the design doc's "the same
// rendering the dashboard uses" for export.

const LANE_HEIGHT = 70;
const COL_WIDTH = 90;
const MARGIN_LEFT = 90;
const MARGIN_TOP = 30;

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface RenderGraphSvgOptions {
  // Export's static SVG doesn't need click handlers or a `<style>` block
  // (the export HTML defines those styles itself, scoped under a class,
  // since it isn't loading the dashboard's stylesheet) — pass false to
  // omit the embedded <style> and just emit plain shapes with classes.
  includeStyle?: boolean;
}

export function renderGraphSvg(graph: DashboardGraph, options: RenderGraphSvgOptions = {}): string {
  const { includeStyle = true } = options;

  if (graph.nodes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="80"></svg>';
  }

  const posOf = (id: string) => {
    const node = graph.nodes.find((n) => n.id === id);
    return node ? { x: MARGIN_LEFT + node.x * COL_WIDTH, y: MARGIN_TOP + node.y * LANE_HEIGHT } : null;
  };

  const width = MARGIN_LEFT + graph.nodes.length * COL_WIDTH + 40;
  const height = Math.max(200, graph.lanes.length * LANE_HEIGHT + MARGIN_TOP * 2);

  const parts: string[] = [];

  if (includeStyle) {
    parts.push(`<style>
      .lane-band { fill: #EDE9E0; }
      .lane-band.odd { fill: #E4E0D5; }
      .node { fill: #EDE9E0; stroke: #C9762F; stroke-width: 2.5; }
      .edge { fill: none; stroke: #55504A; stroke-width: 1.5; opacity: 0.5; }
      .lane-label { fill: #55504A; font: 600 11px 'JetBrains Mono', ui-monospace, monospace; }
      .node-label { fill: #55504A; font: 10px 'JetBrains Mono', ui-monospace, monospace; }
    </style>`);
  }

  graph.lanes.forEach((_lane, i) => {
    const y = MARGIN_TOP + i * LANE_HEIGHT;
    const cls = i % 2 === 1 ? 'lane-band odd' : 'lane-band';
    parts.push(`<rect class="${cls}" x="0" y="${y - LANE_HEIGHT / 2}" width="${width}" height="${LANE_HEIGHT}"></rect>`);
  });
  graph.lanes.forEach((lane, i) => {
    const y = MARGIN_TOP + i * LANE_HEIGHT;
    parts.push(`<text class="lane-label" x="0" y="${y + 4}">${escapeXml(lane)}</text>`);
  });

  for (const node of graph.nodes) {
    const to = posOf(node.id);
    if (!to) continue;
    const parents = node.parents ? node.parents : node.parent ? [node.parent] : [];
    for (const parentId of parents) {
      const from = posOf(parentId);
      if (!from) continue;
      const midX = (from.x + to.x) / 2;
      parts.push(
        `<path class="edge" d="M${from.x},${from.y} C ${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}" />`,
      );
    }
  }

  for (const node of graph.nodes) {
    const p = posOf(node.id);
    if (!p) continue;
    parts.push(`<circle class="node" data-id="${escapeXml(node.id)}" cx="${p.x}" cy="${p.y}" r="7"></circle>`);
    parts.push(
      `<text class="node-label" x="${p.x}" y="${p.y - 14}" text-anchor="middle">${escapeXml(node.shortId)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

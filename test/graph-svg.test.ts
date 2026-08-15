import { describe, it, expect } from 'vitest';
import { renderGraphSvg } from '../src/versioning/graph-svg.js';
import type { DashboardGraph } from '../src/versioning/dashboard.js';

const graph = (overrides: Partial<DashboardGraph> = {}): DashboardGraph => ({
  lanes: ['main'],
  nodes: [
    {
      id: 'sha256:aaa',
      shortId: 'aaa',
      parent: null,
      branch: 'main',
      tool: 'claude',
      timestamp: '2026-01-01T00:00:00Z',
      message: 'first',
      x: 0,
      y: 0,
    },
  ],
  ...overrides,
});

describe('versioning/graph-svg — renderGraphSvg', () => {
  it('returns a minimal empty svg for a graph with no nodes', () => {
    const svg = renderGraphSvg({ lanes: [], nodes: [] });
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('circle');
  });

  it('renders one circle per node, tagged with its full id', () => {
    const svg = renderGraphSvg(graph());
    expect(svg).toContain('class="node" data-id="sha256:aaa"');
  });

  it('renders a lane label for each lane', () => {
    const svg = renderGraphSvg(graph({ lanes: ['main', 'feature'] }));
    expect(svg).toContain('>main<');
    expect(svg).toContain('>feature<');
  });

  it('renders an edge path for a parent-child pair', () => {
    const g = graph({
      nodes: [
        { id: 'sha256:aaa', shortId: 'aaa', parent: null, branch: 'main', tool: 'claude', timestamp: 't1', message: 'm1', x: 0, y: 0 },
        { id: 'sha256:bbb', shortId: 'bbb', parent: 'sha256:aaa', branch: 'main', tool: 'claude', timestamp: 't2', message: 'm2', x: 1, y: 0 },
      ],
    });
    const svg = renderGraphSvg(g);
    expect(svg).toContain('class="edge"');
  });

  it('renders two edges for a merge checkpoint (two parents)', () => {
    const g = graph({
      lanes: ['main', 'feature'],
      nodes: [
        { id: 'sha256:m1', shortId: 'm1', parent: null, branch: 'main', tool: 'claude', timestamp: 't1', message: 'm1', x: 0, y: 0 },
        { id: 'sha256:f1', shortId: 'f1', parent: null, branch: 'feature', tool: 'claude', timestamp: 't2', message: 'f1', x: 1, y: 1 },
        {
          id: 'sha256:merge',
          shortId: 'merge',
          parent: null,
          parents: ['sha256:m1', 'sha256:f1'],
          branch: 'main',
          tool: 'claude',
          timestamp: 't3',
          message: 'merged',
          x: 2,
          y: 0,
        },
      ],
    });
    const svg = renderGraphSvg(g);
    const edgeCount = (svg.match(/class="edge"/g) ?? []).length;
    expect(edgeCount).toBe(2);
  });

  it('escapes XML-sensitive characters in branch names and ids', () => {
    const g = graph({
      lanes: ['<script>&"main"'],
      nodes: [
        {
          id: 'sha256:a&b<c>',
          shortId: 'a&b<c>',
          parent: null,
          branch: '<script>&"main"',
          tool: 'claude',
          timestamp: 't1',
          message: 'm1',
          x: 0,
          y: 0,
        },
      ],
    });
    const svg = renderGraphSvg(g);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('omits the embedded <style> block when includeStyle is false', () => {
    const withStyle = renderGraphSvg(graph(), { includeStyle: true });
    const withoutStyle = renderGraphSvg(graph(), { includeStyle: false });
    expect(withStyle).toContain('<style>');
    expect(withoutStyle).not.toContain('<style>');
  });

  it('includes the embedded <style> block by default', () => {
    expect(renderGraphSvg(graph())).toContain('<style>');
  });
});

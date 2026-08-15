import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildExportData } from '../src/versioning/export.js';
import { renderExportHtml, renderExportMarkdown } from '../src/versioning/export-render.js';
import { exportCommand } from '../src/commands/export.js';
import { createBranch } from '../src/versioning/branches.js';
import { setActiveBranch } from '../src/versioning/active.js';
import { recordCheckpoint } from '../src/versioning/checkpoint.js';

describe('versioning/export — buildExportData', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-export-data-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('errors for a branch with no brg context', () => {
    expect(buildExportData('ghost')).toEqual({ error: expect.stringContaining('ghost') });
  });

  it('gathers intent, chronological entries, and facts', () => {
    createBranch('main', 'Explore payments');
    recordCheckpoint('main', 'claude', 'chose stripe', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');

    const data = buildExportData('main');
    expect(data).toMatchObject({
      branch: 'main',
      intent: 'Explore payments',
      entries: [{ tool: 'claude', message: 'chose stripe', factsDelta: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }] }],
      facts: [{ subject: 'payments', relation: 'provider', object: 'stripe' }],
    });
  });

  it('entries are in chronological (oldest first) order', () => {
    createBranch('main', 'root');
    recordCheckpoint('main', 'claude', 'first', [], 'manual');
    recordCheckpoint('main', 'claude', 'second', [], 'manual');

    const data = buildExportData('main');
    if ('error' in data) throw new Error('unexpected error');
    expect(data.entries.map((e) => e.message)).toEqual(['first', 'second']);
  });

  it('an empty branch has no entries and no facts', () => {
    createBranch('main', 'root');
    const data = buildExportData('main');
    if ('error' in data) throw new Error('unexpected error');
    expect(data.entries).toEqual([]);
    expect(data.facts).toEqual([]);
  });
});

describe('versioning/export-render — renderExportMarkdown', () => {
  it('includes branch heading, intent, decision log, and facts table', () => {
    const md = renderExportMarkdown({
      branch: 'feature-payments',
      intent: 'Add Stripe support',
      entries: [
        { id: 'sha256:aaa', shortId: 'aaa', timestamp: '2026-01-01T00:00:00Z', tool: 'claude', message: 'chose stripe', factsDelta: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }] },
      ],
      facts: [{ subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: 'sha256:aaa', confidence: 'stated' }],
    });

    expect(md).toContain('# Branch: feature-payments');
    expect(md).toContain('Add Stripe support');
    expect(md).toContain('chose stripe');
    expect(md).toContain('+ payments: provider stripe');
    expect(md).toContain('| payments | provider | stripe | stated |');
  });

  it('renders placeholders for empty intent/entries/facts instead of blank sections', () => {
    const md = renderExportMarkdown({ branch: 'main', intent: '', entries: [], facts: [] });
    expect(md).toContain('(no intent recorded)');
    expect(md).toContain('(no checkpoints recorded yet)');
    expect(md).toContain('(no facts recorded yet)');
  });

  it('a remove fact op renders with a minus sign', () => {
    const md = renderExportMarkdown({
      branch: 'main',
      intent: '',
      entries: [{ id: 'x', shortId: 'x', timestamp: 't', tool: 'claude', message: 'm', factsDelta: [{ op: 'remove', subject: 's', relation: 'r', object: 'o' }] }],
      facts: [],
    });
    expect(md).toContain('− s: r o');
  });
});

describe('versioning/export-render — renderExportHtml', () => {
  const baseData = {
    branch: 'feature-payments',
    intent: 'Add Stripe support',
    entries: [
      { id: 'sha256:aaa', shortId: 'aaa', timestamp: '2026-01-01T00:00:00Z', tool: 'claude', message: 'chose stripe', factsDelta: [] },
    ],
    facts: [{ subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: 'sha256:aaa', confidence: 'stated' }],
  };

  it('is a self-contained, valid-looking HTML document', () => {
    const html = renderExportHtml(baseData, '<svg><circle /></svg>');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
  });

  it('embeds the given graph SVG inline', () => {
    const html = renderExportHtml(baseData, '<svg data-test-marker="abc123"></svg>');
    expect(html).toContain('data-test-marker="abc123"');
  });

  it('escapes HTML-sensitive characters in branch name, intent, and messages', () => {
    const html = renderExportHtml(
      { ...baseData, branch: '<b>x</b>', intent: '<script>alert(1)</script>' },
      '<svg></svg>',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('mentions print-to-PDF instead of generating a PDF itself', () => {
    const html = renderExportHtml(baseData, '<svg></svg>');
    expect(html.toLowerCase()).toContain('print');
  });
});

describe('brg export command', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-export-cmd-'));
    process.chdir(tmpDir);
    createBranch('main', 'Explore payments');
    setActiveBranch('main');
    recordCheckpoint('main', 'claude', 'chose stripe', [
      { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
    ], 'manual');
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('defaults to markdown format and the active branch, writing brg-export-<branch>.md', async () => {
    await exportCommand({});

    const outPath = path.join(tmpDir, 'brg-export-main.md');
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.readFileSync(outPath, 'utf8')).toContain('chose stripe');
  });

  it('--format html writes a self-contained HTML file with the graph embedded', async () => {
    await exportCommand({ format: 'html' });

    const outPath = path.join(tmpDir, 'brg-export-main.html');
    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('<!doctype html>');
    expect(content).toContain('<svg');
  });

  it('--out overrides the default output path', async () => {
    const customPath = path.join(tmpDir, 'custom-name.md');
    await exportCommand({ out: customPath });

    expect(fs.existsSync(customPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'brg-export-main.md'))).toBe(false);
  });

  it('--branch overrides the active branch', async () => {
    createBranch('feature', 'a feature');
    recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

    await exportCommand({ branch: 'feature' });

    const outPath = path.join(tmpDir, 'brg-export-feature.md');
    expect(fs.readFileSync(outPath, 'utf8')).toContain('feature work');
  });

  it('errors cleanly for an unknown branch', async () => {
    await exportCommand({ branch: 'ghost' });
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'brg-export-ghost.md'))).toBe(false);
  });

  it('errors cleanly for an unknown format', async () => {
    await exportCommand({ format: 'pdf' });
    expect(process.exitCode).toBe(1);
  });

  it('errors cleanly when there is no active branch and none is specified', async () => {
    fs.rmSync(path.join(tmpDir, '.brg', 'refs', 'active'));
    await exportCommand({});
    expect(process.exitCode).toBe(1);
  });
});

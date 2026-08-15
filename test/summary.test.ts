import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { regenerateSummary } from '../src/versioning/summary.js';
import { createBranch, readSummary } from '../src/versioning/branches.js';
import { recordCheckpoint, recordMergeCheckpoint } from '../src/versioning/checkpoint.js';

describe('versioning/summary — regenerateSummary', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-summary-'));
    process.chdir(tmpDir);
    createBranch('main', 'root');
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is empty for a branch with no checkpoints', () => {
    regenerateSummary('main');
    expect(readSummary('main')).toBe('');
  });

  it('is regenerated automatically by recordCheckpoint — no separate call needed', () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');
    expect(readSummary('main')).toContain('did the thing');
  });

  it('falls back to a formatted message line when contextText is absent', () => {
    recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');
    const content = readSummary('main');
    expect(content).toMatch(/^- \[.*\] claude: did the thing/);
  });

  it('uses contextText verbatim when present, instead of the fallback format', () => {
    recordCheckpoint('main', 'claude', 'short label', [], 'tool-summary', '- [2026-01-01T00:00:00.000Z] claude: a much richer generated summary');
    const content = readSummary('main');
    expect(content).toContain('a much richer generated summary');
    expect(content).not.toContain('short label');
  });

  it('accumulates multiple checkpoints in chronological order', () => {
    recordCheckpoint('main', 'claude', 'first', [], 'manual');
    recordCheckpoint('main', 'claude', 'second', [], 'manual');
    recordCheckpoint('main', 'claude', 'third', [], 'manual');

    const content = readSummary('main');
    const firstIdx = content.indexOf('first');
    const secondIdx = content.indexOf('second');
    const thirdIdx = content.indexOf('third');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('drops the oldest entries once the char budget is exceeded, keeping the newest', () => {
    for (let i = 0; i < 10; i++) {
      recordCheckpoint('main', 'claude', `entry ${i} ${'x'.repeat(200)}`, [], 'manual');
    }

    regenerateSummary('main', tmpDir, 1000);
    const content = readSummary('main');

    expect(content).toContain('entry 9');
    expect(content).not.toContain('entry 0 ');
  });

  it("a single checkpoint's own text larger than the whole budget is still kept, truncated, rather than dropped", () => {
    recordCheckpoint('main', 'claude', 'x'.repeat(5000), [], 'manual');

    regenerateSummary('main', tmpDir, 100);
    const content = readSummary('main');

    expect(content.trim().length).toBeGreaterThan(0);
    expect(content.trim().length).toBeLessThanOrEqual(100);
  });

  it('different branches have independent summaries', () => {
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'main work', [], 'manual');
    recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

    expect(readSummary('main')).toContain('main work');
    expect(readSummary('main')).not.toContain('feature work');
    expect(readSummary('feature')).toContain('feature work');
    expect(readSummary('feature')).not.toContain('main work');
  });

  it('a merge checkpoint (no contextText) regenerates the target summary using the fallback format', () => {
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'main work', [], 'manual');
    recordCheckpoint('feature', 'claude', 'feature work', [], 'manual');

    recordMergeCheckpoint('main', 'feature', 'claude', 'merged feature into main', []);

    expect(readSummary('main')).toContain('merged feature into main');
  });
});

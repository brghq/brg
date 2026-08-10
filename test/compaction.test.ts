import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCommand } from '../src/commands/init.js';
import { contextPath, compactIfNeeded } from '../src/core/context.js';

describe('context.md compaction', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-compaction-'));
    process.chdir(tmpDir);
    initCommand();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('leaves a small context.md untouched', () => {
    const file = contextPath();
    const before = fs.readFileSync(file, 'utf8');

    compactIfNeeded();

    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
  });

  it('rolls old entries into a summary line once past the size threshold, keeping a .bak', () => {
    const file = contextPath();
    const header = fs.readFileSync(file, 'utf8');

    // Each padded line is ~600 bytes; 100 of them clears the 50KB threshold
    // while leaving well more than KEEP_RECENT_ENTRIES (20) behind.
    const entries = Array.from(
      { length: 100 },
      (_, i) => `- [2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z] claude: entry ${i} ${'x'.repeat(560)}`,
    );
    fs.writeFileSync(file, header + entries.join('\n') + '\n', 'utf8');

    compactIfNeeded();

    const after = fs.readFileSync(file, 'utf8');
    expect(after.length).toBeLessThan(entries.join('\n').length);
    expect(after).toContain('compacted through');
    expect(after).toContain('entry 99');
    expect(after).not.toContain('entry 0 ');
    expect(fs.existsSync(`${file}.bak`)).toBe(true);
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toContain('entry 0 ');
  });
});

import { describe, it, expect } from 'vitest';
import { aiAssisted } from '../src/context-strategies/ai-assisted.js';
import { manual } from '../src/context-strategies/manual.js';
import type { ToolAdapter } from '../src/tools/types.js';

function baseAdapter(overrides: Partial<ToolAdapter> = {}): ToolAdapter {
  return {
    name: 'mock-tool',
    displayName: 'Mock Tool',
    isInstalled: () => true,
    install: async () => {},
    isLoggedIn: () => true,
    login: async () => {},
    launch: () => {},
    ...overrides,
  };
}

describe('ai-assisted context strategy', () => {
  it('uses tier 1 (self-summarize) when it succeeds', async () => {
    const tool = baseAdapter({
      summarizeViaSelf: async () => 'decided to use SQLite, touched db.ts and schema.sql',
    });

    const result = await aiAssisted.generate('wrap up db work', tool);

    expect(result.source).toBe('tool-summary');
    expect(result.text).toContain('decided to use SQLite, touched db.ts and schema.sql');
    expect(result.text).not.toContain('wrap up db work');
  });

  it('falls through to tier 2 (transcript extract) when self-summarize is unavailable', async () => {
    const tool = baseAdapter({
      summarizeViaSelf: async () => null,
      getLatestTranscript: () => ({
        text: 'user: please add auth\nassistant: added middleware in auth.ts',
        truncated: false,
        sourcePath: '/fake/path.jsonl',
      }),
    });

    const result = await aiAssisted.generate('wrap up auth work', tool);

    expect(result.source).toBe('transcript-extract');
    expect(result.text).toContain('wrap up auth work');
    expect(result.text).toContain('added middleware in auth.ts');
  });

  it('falls through to tier 3 (manual) when neither tier is available, matching manual output', async () => {
    const tool = baseAdapter();

    const [aiResult, manualResult] = await Promise.all([
      aiAssisted.generate('plain message', tool),
      manual.generate('plain message', tool),
    ]);

    expect(aiResult.source).toBe('manual');
    // Both lines are generated close together and format identically apart
    // from the millisecond-precision timestamp.
    expect(aiResult.text.replace(/\[.*?\]/, '[T]')).toBe(manualResult.text.replace(/\[.*?\]/, '[T]'));
  });

  it('falls through to tier 3 when tier 1 and tier 2 both come back empty', async () => {
    const tool = baseAdapter({
      summarizeViaSelf: async () => null,
      getLatestTranscript: () => null,
    });

    const result = await aiAssisted.generate('nothing to extract', tool);

    expect(result.source).toBe('manual');
    expect(result.text).toContain('mock-tool: nothing to extract');
    expect(result.text).not.toContain('<details>');
  });
});

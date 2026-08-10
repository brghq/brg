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

    const line = await aiAssisted.generate('wrap up db work', tool);

    expect(line).toContain('decided to use SQLite, touched db.ts and schema.sql');
    expect(line).not.toContain('wrap up db work');
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

    const line = await aiAssisted.generate('wrap up auth work', tool);

    expect(line).toContain('wrap up auth work');
    expect(line).toContain('added middleware in auth.ts');
  });

  it('falls through to tier 3 (manual) when neither tier is available, matching manual output', async () => {
    const tool = baseAdapter();

    const [aiLine, manualLine] = await Promise.all([
      aiAssisted.generate('plain message', tool),
      manual.generate('plain message', tool),
    ]);

    // Both lines are generated close together and format identically apart
    // from the millisecond-precision timestamp.
    expect(aiLine.replace(/\[.*?\]/, '[T]')).toBe(manualLine.replace(/\[.*?\]/, '[T]'));
  });

  it('falls through to tier 3 when tier 1 and tier 2 both come back empty', async () => {
    const tool = baseAdapter({
      summarizeViaSelf: async () => null,
      getLatestTranscript: () => null,
    });

    const line = await aiAssisted.generate('nothing to extract', tool);

    expect(line).toContain('mock-tool: nothing to extract');
    expect(line).not.toContain('<details>');
  });
});

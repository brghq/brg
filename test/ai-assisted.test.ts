import { describe, it, expect } from 'vitest';
import { aiAssisted } from '../src/context-strategies/ai-assisted.js';
import { manual } from '../src/context-strategies/manual.js';
import type { ToolAdapter } from '../src/tools/types.js';
import type { Fact } from '../src/versioning/types.js';

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

const fact = (subject: string, relation: string, object: string): Fact => ({
  subject,
  relation,
  object,
  checkpoint: 'sha256:x',
  confidence: 'stated',
});

describe('ai-assisted context strategy', () => {
  it('uses tier 1 (self-summarize) when it succeeds, with a plain-text response (no JSON)', async () => {
    const tool = baseAdapter({
      summarizeViaSelf: async () => 'decided to use SQLite, touched db.ts and schema.sql',
    });

    const result = await aiAssisted.generate('wrap up db work', tool, []);

    expect(result.source).toBe('tool-summary');
    expect(result.text).toContain('decided to use SQLite, touched db.ts and schema.sql');
    expect(result.text).not.toContain('wrap up db work');
    expect(result.factsDelta).toEqual([]);
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

    const result = await aiAssisted.generate('wrap up auth work', tool, []);

    expect(result.source).toBe('transcript-extract');
    expect(result.text).toContain('wrap up auth work');
    expect(result.text).toContain('added middleware in auth.ts');
    expect(result.factsDelta).toEqual([]);
  });

  it('falls through to tier 3 (manual) when neither tier is available, matching manual output', async () => {
    const tool = baseAdapter();

    const [aiResult, manualResult] = await Promise.all([
      aiAssisted.generate('plain message', tool, []),
      manual.generate('plain message', tool, []),
    ]);

    expect(aiResult.source).toBe('manual');
    // Both lines are generated close together and format identically apart
    // from the millisecond-precision timestamp.
    expect(aiResult.text.replace(/\[.*?\]/, '[T]')).toBe(manualResult.text.replace(/\[.*?\]/, '[T]'));
    expect(aiResult.factsDelta).toEqual([]);
  });

  it('falls through to tier 3 when tier 1 and tier 2 both come back empty', async () => {
    const tool = baseAdapter({
      summarizeViaSelf: async () => null,
      getLatestTranscript: () => null,
    });

    const result = await aiAssisted.generate('nothing to extract', tool, []);

    expect(result.source).toBe('manual');
    expect(result.text).toContain('mock-tool: nothing to extract');
    expect(result.text).not.toContain('<details>');
    expect(result.factsDelta).toEqual([]);
  });

  describe('combined summary+facts JSON response (tier 1)', () => {
    it('parses a well-formed JSON response into summary text and factsDelta', async () => {
      const tool = baseAdapter({
        summarizeViaSelf: async () =>
          JSON.stringify({
            summary: 'chose Stripe over Razorpay for webhooks',
            facts: [{ op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' }],
          }),
      });

      const result = await aiAssisted.generate('wrap up payments work', tool, []);

      expect(result.source).toBe('tool-summary');
      expect(result.text).toContain('chose Stripe over Razorpay for webhooks');
      expect(result.factsDelta).toEqual([
        { op: 'add', subject: 'payments', relation: 'provider', object: 'stripe' },
      ]);
    });

    it('tolerates a response wrapped in a markdown code fence', async () => {
      const tool = baseAdapter({
        summarizeViaSelf: async () =>
          '```json\n' +
          JSON.stringify({ summary: 'did the thing', facts: [{ op: 'add', subject: 's', relation: 'r', object: 'o' }] }) +
          '\n```',
      });

      const result = await aiAssisted.generate('msg', tool, []);

      expect(result.text).toContain('did the thing');
      expect(result.factsDelta).toEqual([{ op: 'add', subject: 's', relation: 'r', object: 'o' }]);
    });

    it('falls back to using the raw response as plain summary text when it is not JSON', async () => {
      const tool = baseAdapter({
        summarizeViaSelf: async () => 'not json at all, just a sentence.',
      });

      const result = await aiAssisted.generate('msg', tool, []);

      expect(result.text).toContain('not json at all, just a sentence.');
      expect(result.factsDelta).toEqual([]);
    });

    it('includes existing facts in the instruction sent to the tool', async () => {
      let capturedInstruction = '';
      const tool = baseAdapter({
        summarizeViaSelf: async (instruction) => {
          capturedInstruction = instruction;
          return JSON.stringify({ summary: 's', facts: [] });
        },
      });

      await aiAssisted.generate('msg', tool, [fact('payments', 'provider', 'stripe')]);

      expect(capturedInstruction).toContain('payments provider: stripe');
    });

    it('an empty existing-facts array does not add a "known facts" section to the instruction', async () => {
      let capturedInstruction = '';
      const tool = baseAdapter({
        summarizeViaSelf: async (instruction) => {
          capturedInstruction = instruction;
          return JSON.stringify({ summary: 's', facts: [] });
        },
      });

      await aiAssisted.generate('msg', tool, []);

      expect(capturedInstruction).not.toContain('Known facts');
    });
  });
});

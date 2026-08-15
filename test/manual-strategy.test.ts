import { describe, it, expect } from 'vitest';
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

describe('manual context strategy', () => {
  it('always returns an empty factsDelta — no AI call, so no facts can be extracted', async () => {
    const result = await manual.generate('did the thing', baseAdapter(), []);
    expect(result.factsDelta).toEqual([]);
    expect(result.source).toBe('manual');
  });

  it('ignores existingFacts entirely — passing a non-empty array does not change its output shape', async () => {
    const existingFacts: Fact[] = [
      { subject: 'payments', relation: 'provider', object: 'stripe', checkpoint: 'sha256:x', confidence: 'stated' },
    ];
    const result = await manual.generate('did the thing', baseAdapter(), existingFacts);
    expect(result.factsDelta).toEqual([]);
  });

  it('formats the message with a timestamp regardless of facts input', async () => {
    const result = await manual.generate('did the thing', baseAdapter(), []);
    expect(result.text).toMatch(/^- \[.*\] mock-tool: did the thing/);
  });
});

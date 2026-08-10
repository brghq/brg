import type { ContextStrategy } from './types.js';

/**
 * STUB — not implemented in the MVP.
 *
 * Idea for later: instead of calling an external summarization API, shell
 * out to the user's *currently active* tool (whatever they're already
 * logged into, e.g. `claude -p "summarize this session in one line"`) so
 * no separate API key is ever required. `core/context.ts` depends only on
 * the ContextStrategy interface, so wiring this in later is a one-line
 * config.yaml change (`contextStrategy: ai-assisted`), not a rewrite.
 *
 * TODO: implement generate() by shelling out to `tool`'s non-interactive
 * prompt mode (e.g. `claude -p "..."`) once each adapter exposes a
 * standard way to run a one-shot prompt.
 */
export const aiAssisted: ContextStrategy = {
  name: 'ai-assisted',

  async generate(_userMessage, _tool) {
    throw new Error('ai-assisted context strategy is not implemented yet');
  },
};

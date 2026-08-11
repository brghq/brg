import type { ContextStrategy } from './types.js';
import { manual } from './manual.js';

const SUMMARY_INSTRUCTION =
  'Summarize this session in under 200 words: key decisions made, files touched, and open threads. Plain text, no markdown headers.';

const TRANSCRIPT_EXCERPT_CHARS = 2_000;

/**
 * Three-tier fallback, richest to cheapest, each tier requiring strictly
 * less of what might be unavailable than the one before it:
 *
 *   1. Ask the tool to summarize its own session (`--continue` / `resume
 *      --last`). Richest output, but needs that tool's own auth + quota —
 *      exactly what may have just been exhausted.
 *   2. Read the tool's on-disk transcript directly and extract raw text.
 *      No network, no auth, no quota — pure local file I/O, so this stays
 *      available even when tier 1 can't run.
 *   3. Fall back to the plain manual line (same as the `manual` strategy).
 *
 * Every tier is optional on the adapter and never throws, so this always
 * produces *something* — degrading in richness, never failing outright.
 */
export const aiAssisted: ContextStrategy = {
  name: 'ai-assisted',

  async generate(userMessage, tool) {
    const timestamp = new Date().toISOString();

    if (tool.summarizeViaSelf) {
      const summary = await tool.summarizeViaSelf(SUMMARY_INSTRUCTION);
      if (summary) {
        return `- [${timestamp}] ${tool.name}: ${summary}`;
      }
    }

    if (tool.getLatestTranscript) {
      const extract = tool.getLatestTranscript(process.cwd());
      if (extract && extract.text.trim()) {
        const excerpt = extract.text.slice(-TRANSCRIPT_EXCERPT_CHARS);
        const truncated = extract.truncated || extract.text.length > TRANSCRIPT_EXCERPT_CHARS;
        const note = truncated ? ' (truncated)' : '';
        return (
          `- [${timestamp}] ${tool.name}: ${userMessage}\n` +
          `  <details><summary>transcript excerpt${note}</summary>\n\n` +
          excerpt
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n') +
          `\n  </details>`
        );
      }
    }

    return manual.generate(userMessage, tool);
  },
};

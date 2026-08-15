import type { ContextStrategy } from './types.js';
import { manual } from './manual.js';
import { parseSummaryWithFacts } from './parse-facts-response.js';
import type { Fact } from '../versioning/types.js';

const TRANSCRIPT_EXCERPT_CHARS = 2_000;

// Combined instruction: asks for summary AND structured facts in one
// call, instead of two separate calls (one for text, one for facts) —
// the tool already has the full session loaded via --continue, so this
// halves the latency/cost of the naive two-call approach. Feeding in the
// branch's current facts lets the model report only what's new/changed,
// matching the design doc's "incremental" requirement, instead of
// re-stating everything every checkpoint.
function buildInstruction(existingFacts: Fact[]): string {
  const factsContext =
    existingFacts.length > 0
      ? `Known facts so far:\n${existingFacts.map((f) => `- ${f.subject} ${f.relation}: ${f.object}`).join('\n')}\n\n`
      : '';

  return (
    `${factsContext}Summarize this session in under 200 words: key decisions made, files touched, and open ` +
    'threads. Plain text, no markdown headers. Also identify any NEW or CHANGED facts established in this ' +
    'session (skip anything already listed above as a known fact).\n\n' +
    'Respond with exactly this JSON shape and nothing else — no markdown code fences, no text before or after:\n' +
    '{"summary": "<the summary>", "facts": [{"op": "add"|"remove", "subject": "<short noun>", ' +
    '"relation": "<short relation>", "object": "<short value>"}]}\n\n' +
    'If no new facts were established, use an empty facts array.'
  );
}

/**
 * Three-tier fallback, richest to cheapest, each tier requiring strictly
 * less of what might be unavailable than the one before it:
 *
 *   1. Ask the tool to summarize its own session (`--continue` / `resume
 *      --last`), requesting summary + structured facts together in one
 *      call. Richest output, but needs that tool's own auth + quota —
 *      exactly what may have just been exhausted. If the model doesn't
 *      follow the JSON format, the raw response is used as a plain
 *      summary instead (facts empty) rather than losing the checkpoint.
 *   2. Read the tool's on-disk transcript directly and extract raw text.
 *      No network, no auth, no quota — pure local file I/O, so this stays
 *      available even when tier 1 can't run. No facts extraction here —
 *      that needs a live model call, which this tier by definition
 *      doesn't make.
 *   3. Fall back to the plain manual line (same as the `manual`
 *      strategy). No facts either, same reason.
 *
 * Every tier is optional on the adapter and never throws, so this always
 * produces *something* — degrading in richness, never failing outright.
 */
export const aiAssisted: ContextStrategy = {
  name: 'ai-assisted',

  async generate(userMessage, tool, existingFacts) {
    const timestamp = new Date().toISOString();

    if (tool.summarizeViaSelf) {
      const raw = await tool.summarizeViaSelf(buildInstruction(existingFacts));
      if (raw) {
        const parsed = parseSummaryWithFacts(raw);
        if (parsed) {
          return {
            text: `- [${timestamp}] ${tool.name}: ${parsed.summary}`,
            source: 'tool-summary',
            factsDelta: parsed.facts,
          };
        }
        // Model didn't follow the JSON format — use the raw response as
        // a plain summary rather than discarding a real, richer answer.
        return { text: `- [${timestamp}] ${tool.name}: ${raw}`, source: 'tool-summary', factsDelta: [] };
      }
    }

    if (tool.getLatestTranscript) {
      const extract = tool.getLatestTranscript(process.cwd());
      if (extract && extract.text.trim()) {
        const excerpt = extract.text.slice(-TRANSCRIPT_EXCERPT_CHARS);
        const truncated = extract.truncated || extract.text.length > TRANSCRIPT_EXCERPT_CHARS;
        const note = truncated ? ' (truncated)' : '';
        const text =
          `- [${timestamp}] ${tool.name}: ${userMessage}\n` +
          `  <details><summary>transcript excerpt${note}</summary>\n\n` +
          excerpt
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n') +
          `\n  </details>`;
        return { text, source: 'transcript-extract', factsDelta: [] };
      }
    }

    return manual.generate(userMessage, tool, existingFacts);
  },
};

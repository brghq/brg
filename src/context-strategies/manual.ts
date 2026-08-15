import { execFileSync } from 'node:child_process';
import type { ContextStrategy } from './types.js';

/**
 * `manual` is the offline fallback strategy — the floor tier of
 * `ai-assisted` (the actual default, see context-strategies/ai-assisted.ts)
 * and directly selectable via `contextStrategy: manual` for anyone who
 * wants checkpoints to never shell out to a CLI or touch its transcripts.
 * It enriches the user's own message with one genuinely free,
 * always-available signal already on disk: the current git branch and a
 * one-line diffstat, if the project is a git repo. If a project isn't a
 * git repo, or git isn't installed, this silently degrades to a plain log
 * line — never blocks a checkpoint.
 */
export const manual: ContextStrategy = {
  name: 'manual',

  async generate(userMessage, tool) {
    const timestamp = new Date().toISOString();
    const gitSuffix = getGitSummary();
    const suffix = gitSuffix ? ` (${gitSuffix})` : '';
    // No AI call here by design (see the doc comment above) — factsDelta
    // is always empty, since only a live model call can extract facts.
    return { text: `- [${timestamp}] ${tool.name}: ${userMessage}${suffix}`, source: 'manual', factsDelta: [] };
  },
};

function getGitSummary(): string | null {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const diffstat = execFileSync('git', ['diff', '--shortstat'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return diffstat ? `${branch}, ${diffstat}` : branch;
  } catch {
    return null;
  }
}

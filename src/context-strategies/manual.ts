import { execFileSync } from 'node:child_process';
import type { ContextStrategy } from './types.js';

/**
 * Design note: `manual` is the default and only strategy wired up for the
 * MVP. Considered enriching it with an AI-generated summary (shelling out
 * to the user's already-authenticated tool, e.g. `claude -p "summarize..."`)
 * but that adds latency, a dependency on the tool being installed and
 * logged in at checkpoint time, and per-CLI flag fragility — exactly the
 * cost this design avoids. Instead this strategy stays purely offline and
 * enriches the user's own message with one genuinely free, always-available
 * signal already on disk: the current git branch and a one-line diffstat,
 * if the project is a git repo. That's useful context ("what was touched")
 * without adding any dependency, network call, or API key. If a project
 * isn't a git repo, or git isn't installed, this silently degrades to a
 * plain log line — never blocks a checkpoint.
 */
export const manual: ContextStrategy = {
  name: 'manual',

  async generate(userMessage, tool) {
    const timestamp = new Date().toISOString();
    const gitSuffix = getGitSummary();
    const suffix = gitSuffix ? ` (${gitSuffix})` : '';
    return `- [${timestamp}] ${tool.name}: ${userMessage}${suffix}`;
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

import { setActiveBranch } from '../versioning/active.js';
import { branchExists, readIntent, readLog, readSummary } from '../versioning/branches.js';
import { getMapping } from '../versioning/gitmap.js';
import { runGitCheckout } from '../versioning/git.js';
import { readObject } from '../versioning/objects.js';
import { amber, bold, dim } from '../utils/style.js';

const RECENT_CHECKPOINTS = 5;

/**
 * Switches to a brg branch by name and restores its context (intent,
 * summary, a small window of recent checkpoints) — a lazy restore, never
 * a full history replay, per the design doc.
 *
 * Only runs `git checkout` if this brg branch actually has a matching git
 * branch (per refs/git-map.json). A brg branch created without one (see
 * commands/branch.ts) switches purely in brg's own state, leaving
 * whatever git branch you're on untouched — this is what makes it
 * possible to fork context without forking git history.
 *
 * If <name> isn't a tracked brg branch at all, it's treated as a plain
 * git branch name instead: `git checkout <name>` still runs, brg's
 * restore is just skipped. brg's context features are always a
 * best-effort add-on, never a gate on the underlying git operation.
 */
export async function checkoutCommand(name: string): Promise<void> {
  if (!branchExists(name)) {
    const exitCode = runGitCheckout([name]);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      return;
    }
    console.log(
      dim(
        `(no brg context for branch "${name}" yet — run "brg branch" to create one, or "brg checkpoint" to start recording)`,
      ),
    );
    return;
  }

  const mapping = getMapping(name);
  if (mapping) {
    const exitCode = runGitCheckout([mapping.git_branch]);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      return;
    }
  } else {
    console.log(dim('(no git branch linked to this context — staying on the current git branch)'));
  }

  setActiveBranch(name);

  const intent = readIntent(name).trim();
  const summary = readSummary(name).trim();
  const log = readLog(name);

  console.log(`${amber('✓')} Switched to "${name}"`);
  if (intent) console.log(`\n${bold('Intent:')} ${intent}`);
  if (summary) console.log(`\n${bold('Summary:')}\n${summary}`);

  if (log.length === 0) {
    console.log(dim('\n(no checkpoints recorded on this branch yet)'));
    return;
  }

  console.log(`\n${bold('Recent checkpoints:')}`);
  for (const id of log.slice(-RECENT_CHECKPOINTS).reverse()) {
    const checkpoint = readObject(id);
    if (checkpoint) {
      console.log(`  ${dim(checkpoint.timestamp)} ${checkpoint.tool}: ${checkpoint.message}`);
    }
  }
}

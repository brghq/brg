import { branchExists, readIntent, readLog, readSummary } from '../versioning/branches.js';
import { runGitCheckout } from '../versioning/git.js';
import { readObject } from '../versioning/objects.js';
import { amber, bold, dim } from '../utils/style.js';

const RECENT_CHECKPOINTS = 5;

/**
 * Runs `git checkout <name>` and, on success, restores that branch's brg
 * context (intent, summary, a small window of recent checkpoints) — a
 * lazy restore, never a full history replay, per the design doc.
 *
 * If <name> is a real git branch with no matching brg branch (e.g. made
 * with plain `git branch`), the checkout still succeeds — brg's restore
 * is a best-effort add-on, never a gate on the underlying git operation.
 */
export async function checkoutCommand(name: string): Promise<void> {
  const exitCode = runGitCheckout([name]);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }

  if (!branchExists(name)) {
    console.log(
      dim(
        `(no brg context for branch "${name}" yet — run "brg branch" to create one, or "brg checkpoint" to start recording)`,
      ),
    );
    return;
  }

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

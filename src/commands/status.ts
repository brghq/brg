import { isInitialized, readConfig } from '../core/config.js';
import { getActiveBranch } from '../versioning/active.js';
import { readLog, readSummary } from '../versioning/branches.js';
import { currentGitBranch } from '../versioning/git.js';
import { getMapping } from '../versioning/gitmap.js';
import { readObject } from '../versioning/objects.js';
import { dim } from '../utils/style.js';

function formatElapsed(since: Date): string {
  const ms = Date.now() - since.getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function statusCommand(): void {
  if (!isInitialized()) {
    console.log(dim('Not a brg project. Run "brg init" to get started.'));
    return;
  }

  const config = readConfig();
  const branch = getActiveBranch();
  const log = branch ? readLog(branch) : [];
  const lastId = log[log.length - 1];
  const last = lastId ? readObject(lastId) : null;
  const summarySize = branch ? Buffer.byteLength(readSummary(branch), 'utf8') : 0;

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = log.filter((id) => readObject(id)?.timestamp.slice(0, 10) === today).length;

  const gitBranch = currentGitBranch();
  const linkedGitBranch = branch ? getMapping(branch)?.git_branch : undefined;

  console.log(`active branch:     ${branch ?? dim('(none)')}`);
  console.log(`git branch:        ${gitBranch ?? dim('(not a git repo)')}`);
  console.log(`active tool:       ${config.defaultTool ?? dim('(not set)')}`);
  console.log(`last checkpoint:   ${last ? formatElapsed(new Date(last.timestamp)) : dim('never')}`);
  console.log(`summary size:      ${summarySize} bytes`);
  console.log(`checkpoints today: ${todayCount}`);

  // The active context branch and the checked-out git branch are
  // independent lineages by design — this is purely informational, never
  // a signal brg acts on (see the "context branch vs git branch" spec).
  if (branch && gitBranch) {
    if (linkedGitBranch && linkedGitBranch !== gitBranch) {
      console.log(
        dim(
          `\n⚠ context branch "${branch}" is linked to git branch "${linkedGitBranch}", but you're currently on "${gitBranch}"`,
        ),
      );
    } else if (!linkedGitBranch) {
      console.log(
        dim(`\n⚠ context branch "${branch}" has no linked git branch (currently on git branch "${gitBranch}")`),
      );
    }
  }
}

import { isInitialized } from '../core/config.js';
import { getActiveBranch } from '../versioning/active.js';
import { readSummary } from '../versioning/branches.js';
import { dim } from '../utils/style.js';

export function contextShowCommand(): void {
  if (!isInitialized()) {
    console.error('brg: this project hasn\'t been initialized yet. Run "brg init" first.');
    process.exitCode = 1;
    return;
  }

  const branch = getActiveBranch();
  if (!branch) {
    console.log(dim('(no active branch)'));
    return;
  }

  const content = readSummary(branch);
  if (!content.trim()) {
    console.log(dim(`(no context recorded yet on "${branch}")`));
    return;
  }
  process.stdout.write(content);
}

import readline from 'node:readline/promises';
import { branchExists, createBranch } from '../versioning/branches.js';
import { setMapping } from '../versioning/gitmap.js';
import { currentGitSha, runGitBranch } from '../versioning/git.js';
import { amber, dim } from '../utils/style.js';

export interface BranchOptions {
  intent?: string;
}

async function askIntent(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let answer = '';
    while (!answer) {
      answer = (await rl.question('Intent for this branch: ')).trim();
      if (!answer) console.log(dim('Intent cannot be empty — this is the goal shown on `brg checkout`.'));
    }
    return answer;
  } finally {
    rl.close();
  }
}

/**
 * Creates a real git branch (via `git branch <name>`) and, on success, a
 * matching brg branch (.brg/branches/<name>/) recorded against the sha it
 * was created from. Intent comes from --intent, or an interactive prompt
 * if omitted — never left empty, since it's the whole point of intent.md.
 */
export async function branchCommand(name: string, options: BranchOptions): Promise<void> {
  if (branchExists(name)) {
    console.error(`brg: branch "${name}" already has brg context tracked.`);
    process.exitCode = 1;
    return;
  }

  const intent = options.intent?.trim() || (await askIntent());

  const exitCode = runGitBranch([name]);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }

  const createdFromSha = currentGitSha() ?? 'unknown';
  createBranch(name, intent);
  setMapping(name, { git_branch: name, created_from_sha: createdFromSha });

  console.log(`${amber('✓')} Created branch "${name}" (git + brg context)`);
}

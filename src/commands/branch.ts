import readline from 'node:readline/promises';
import { branchExists, createBranch } from '../versioning/branches.js';
import { setActiveBranch } from '../versioning/active.js';
import { setMapping } from '../versioning/gitmap.js';
import { currentGitSha, isGitRepo, runGitBranch } from '../versioning/git.js';
import { amber, dim } from '../utils/style.js';

export interface BranchOptions {
  intent?: string;
}

export interface GitBranchConfirmation {
  create: boolean;
  name?: string;
}

// Injectable so tests can drive the "also create a git branch?" prompt
// deterministically instead of mocking stdin.
export interface BranchDependencies {
  confirmGitBranch?: (branchName: string) => Promise<GitBranchConfirmation>;
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

async function askGitBranchConfirmation(branchName: string): Promise<GitBranchConfirmation> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const yn = (
      await rl.question(`Also create a matching git branch "${branchName}"? [Y/n] `)
    )
      .trim()
      .toLowerCase();
    if (yn === 'n' || yn === 'no') return { create: false };

    const typed = (await rl.question(`Git branch name (Enter for "${branchName}"): `)).trim();
    return { create: true, name: typed || branchName };
  } finally {
    rl.close();
  }
}

/**
 * Creates a brg context branch — always, unconditionally, this is the
 * primary action and it never depends on git. A matching real git branch
 * is optional: asked about interactively afterward (skipped automatically
 * outside a git repo), never required. Declining still leaves a fully
 * usable, active brg branch with no git-map entry — this is what lets you
 * fork context to explore an angle without creating a git branch or
 * touching the one you're already on.
 */
export async function branchCommand(
  name: string,
  options: BranchOptions,
  deps: BranchDependencies = {},
): Promise<void> {
  if (branchExists(name)) {
    console.error(`brg: branch "${name}" already has brg context tracked.`);
    process.exitCode = 1;
    return;
  }

  const intent = options.intent?.trim() || (await askIntent());

  createBranch(name, intent);
  setActiveBranch(name);
  console.log(`${amber('✓')} Created branch "${name}"`);

  if (!isGitRepo()) {
    console.log(dim('(not a git repository — skipping git branch creation)'));
    return;
  }

  const confirmGitBranch = deps.confirmGitBranch ?? askGitBranchConfirmation;
  const confirmation = await confirmGitBranch(name);
  if (!confirmation.create) {
    return;
  }

  const gitBranchName = confirmation.name?.trim() || name;
  const exitCode = runGitBranch([gitBranchName]);
  if (exitCode !== 0) {
    console.log(dim(`(git branch "${gitBranchName}" was not created — the brg branch still exists on its own)`));
    return;
  }

  setMapping(name, { git_branch: gitBranchName, created_from_sha: currentGitSha() ?? 'unknown' });
  console.log(`${amber('✓')} Linked to git branch "${gitBranchName}"`);
}

import readline from 'node:readline/promises';
import { setActiveBranch, getActiveBranch } from '../versioning/active.js';
import { branchExists, createBranch, readFacts, readIntent, readLog, readSummary, writeFacts } from '../versioning/branches.js';
import { getMapping, setMapping } from '../versioning/gitmap.js';
import { currentGitSha, isGitRepo, runGitBranch, runGitCheckout } from '../versioning/git.js';
import { readObject } from '../versioning/objects.js';
import { amber, bold, dim } from '../utils/style.js';

const RECENT_CHECKPOINTS = 5;

export interface CheckoutOptions {
  intent?: string;
  inherit?: boolean;
  orphan?: boolean;
  // Commander's --git [name] / --no-git pairing: undefined = not passed
  // (ask interactively), false = --no-git, true = --git (no name given,
  // use the branch's own name), string = --git=<custom-name>.
  git?: boolean | string;
}

export interface GitBranchConfirmation {
  create: boolean;
  name?: string;
}

export interface InheritConfirmation {
  inherit: boolean;
}

// Injectable so tests can drive the interactive prompts deterministically
// instead of mocking stdin. Same DI pattern as merge.ts/hook.ts.
export interface CheckoutDependencies {
  confirmGitBranch?: (branchName: string) => Promise<GitBranchConfirmation>;
  confirmInherit?: () => Promise<InheritConfirmation>;
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

async function askInherit(): Promise<InheritConfirmation> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question('Inherit context from the current active branch, or start orphan (fresh)? [i/O] ')
    )
      .trim()
      .toLowerCase();
    return { inherit: answer === 'i' || answer === 'inherit' };
  } finally {
    rl.close();
  }
}

async function askGitBranchConfirmation(branchName: string): Promise<GitBranchConfirmation> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const yn = (await rl.question(`Also create a matching git branch "${branchName}"? [Y/n] `))
      .trim()
      .toLowerCase();
    if (yn === 'n' || yn === 'no') return { create: false };

    const typed = (await rl.question(`Git branch name (Enter for "${branchName}"): `)).trim();
    return { create: true, name: typed || branchName };
  } finally {
    rl.close();
  }
}

async function createAndSwitch(
  name: string,
  options: CheckoutOptions,
  deps: CheckoutDependencies,
): Promise<void> {
  const intent = options.intent?.trim() || (await askIntent());

  let inherit: boolean;
  if (options.inherit) {
    inherit = true;
  } else if (options.orphan) {
    inherit = false;
  } else {
    const confirmInherit = deps.confirmInherit ?? askInherit;
    inherit = (await confirmInherit()).inherit;
  }

  const inheritFrom = inherit ? getActiveBranch() : null;

  createBranch(name, intent);
  if (inheritFrom) {
    writeFacts(name, readFacts(inheritFrom));
  }
  setActiveBranch(name);
  console.log(
    `${amber('✓')} Created branch "${name}"${inheritFrom ? ` (inherited context from "${inheritFrom}")` : ''}`,
  );

  // Git link resolution: --no-git / --git / --git=<name> skip the prompt
  // entirely; otherwise ask (unless not a git repo, in which case there's
  // nothing to link to).
  let confirmation: GitBranchConfirmation;
  if (options.git === false) {
    return;
  } else if (typeof options.git === 'string') {
    confirmation = { create: true, name: options.git };
  } else if (options.git === true) {
    confirmation = { create: true, name };
  } else if (!isGitRepo()) {
    console.log(dim('(not a git repository — skipping git branch creation)'));
    return;
  } else {
    const confirmGitBranch = deps.confirmGitBranch ?? askGitBranchConfirmation;
    confirmation = await confirmGitBranch(name);
  }

  if (!confirmation.create) return;

  const gitBranchName = confirmation.name?.trim() || name;
  const exitCode = runGitBranch([gitBranchName]);
  if (exitCode !== 0) {
    console.log(dim(`(git branch "${gitBranchName}" was not created — the brg branch still exists on its own)`));
    return;
  }

  setMapping(name, { git_branch: gitBranchName, created_from_sha: currentGitSha() ?? 'unknown' });
  console.log(`${amber('✓')} Linked to git branch "${gitBranchName}"`);
}

async function switchToExisting(name: string): Promise<void> {
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

/**
 * The single command for both creating and switching brg context
 * branches — there is no separate `brg branch`. If `<name>` doesn't
 * exist yet, creates it (asking/flag-driven: inherit the active branch's
 * facts or start orphan; link a git branch or not) and switches to it.
 * If it already exists, just switches — never errors on an existing
 * name. Switching only runs `git checkout` when the brg branch has a
 * linked git branch (per refs/git-map.json); a context-only branch
 * switches purely in brg's own state, leaving whatever git branch you're
 * on untouched.
 *
 * `<name>` is always a brg branch name here, not a fallback to a plain
 * `git checkout` for an untracked name — plain `git checkout` is always
 * available directly for that; this command's whole job is context
 * branches.
 */
export async function checkoutCommand(
  name: string,
  options: CheckoutOptions = {},
  deps: CheckoutDependencies = {},
): Promise<void> {
  if (branchExists(name)) {
    await switchToExisting(name);
    return;
  }

  await createAndSwitch(name, options, deps);
}

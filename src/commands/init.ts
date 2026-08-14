import fs from 'node:fs';
import { brgDir, configPath, writeConfig, isInitialized } from '../core/config.js';
import { initContext } from '../core/context.js';
import { sessionsDir } from '../core/session.js';
import { getActiveBranch, setActiveBranch } from '../versioning/active.js';
import { branchExists, createBranch } from '../versioning/branches.js';
import { currentGitBranch, currentGitSha } from '../versioning/git.js';
import { getMapping, setMapping } from '../versioning/gitmap.js';
import { installPostCheckoutHook } from '../versioning/hook.js';
import { amber, dim } from '../utils/style.js';

const DEFAULT_BRANCH_INTENT = 'Default branch, created automatically by "brg init".';

/**
 * Every brg project needs an active branch from the start — `brg merge`
 * and anything else keyed off "the branch I'm currently in" would
 * otherwise have nothing to resolve until the first manual `brg
 * branch`/`brg checkout`. Named after the checked-out git branch when
 * inside a repo (and mapped to it, since that git branch already exists
 * — nothing to create), or "main" outside one. No-ops once an active
 * branch is already set, so it's safe to call on every init, including
 * backfilling a project that was `brg init`-ed before this existed.
 */
function ensureDefaultBranch(): void {
  if (getActiveBranch()) return;

  const gitBranch = currentGitBranch();
  const name = gitBranch ?? 'main';

  if (!branchExists(name)) {
    createBranch(name, DEFAULT_BRANCH_INTENT);
  }
  if (gitBranch && !getMapping(name)) {
    setMapping(name, { git_branch: gitBranch, created_from_sha: currentGitSha() ?? 'unknown' });
  }
  setActiveBranch(name);
}

export function initCommand(): void {
  if (isInitialized()) {
    console.log(dim('brg is already initialized here — nothing to do.'));
    // Still worth running on a re-run: covers a project that was
    // `brg init`-ed before these existed, or before it became a git repo.
    // Both are idempotent.
    installPostCheckoutHook();
    ensureDefaultBranch();
    return;
  }

  fs.mkdirSync(brgDir(), { recursive: true });
  fs.mkdirSync(sessionsDir(), { recursive: true });
  initContext();
  if (!fs.existsSync(configPath())) {
    // ai-assisted degrades all the way down to manual's own output when
    // nothing richer is available, so it's a safe default for new projects.
    writeConfig({ contextStrategy: 'ai-assisted' });
  }
  installPostCheckoutHook();
  ensureDefaultBranch();

  console.log(`${amber('✓')} Initialized .brg/ in ${process.cwd()}`);
}

import fs from 'node:fs';
import path from 'node:path';

// Safety net for the case brg's primary interface (`brg checkout`) doesn't
// cover: someone runs plain `git checkout` outside brg (another terminal,
// an IDE). Never blocks the checkout and never does a rich restore — just
// a best-effort staleness notice, per the design doc.

const HOOK_MARKER = '# brg:post-checkout-safety-net';

function hookScript(): string {
  return `#!/bin/sh
${HOOK_MARKER}
# Installed by "brg init". Flags when a checkout lands on a branch brg has
# no context for yet. Never blocks the checkout — notice only.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ -n "$BRANCH" ] && [ ! -d ".brg/branches/$BRANCH" ]; then
  echo "brg: no context recorded for branch \\"$BRANCH\\" yet — run 'brg branch' or 'brg checkpoint' to start tracking it." >&2
fi
`;
}

function gitHooksDir(cwd: string): string | null {
  return fs.existsSync(path.join(cwd, '.git')) ? path.join(cwd, '.git', 'hooks') : null;
}

/**
 * Idempotently installs the post-checkout safety-net hook. No-ops outside
 * a git repo. Never overwrites a hook that isn't brg's own — if
 * `post-checkout` already exists and doesn't carry brg's marker comment,
 * this leaves it untouched rather than clobbering someone else's hook.
 */
export function installPostCheckoutHook(cwd: string = process.cwd()): void {
  const hooksDir = gitHooksDir(cwd);
  if (!hooksDir) return;

  const hookPath = path.join(hooksDir, 'post-checkout');
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (!existing.includes(HOOK_MARKER)) return;
  }

  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, hookScript(), { mode: 0o755 });
}

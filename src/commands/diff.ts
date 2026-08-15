import { getActiveBranch } from '../versioning/active.js';
import { branchExists, readFacts } from '../versioning/branches.js';
import { diffFacts } from '../versioning/diff.js';
import { amber, bold, dim } from '../utils/style.js';

/**
 * Compares two branches' current fact sets and prints what's different.
 * Pure structural diff (versioning/diff.ts) — no LLM calls, no git
 * involvement beyond the branch names themselves already being resolved
 * to brg branches.
 *
 * One-arg form (`brg diff <name>`) compares the active branch against
 * `<name>`; two-arg form (`brg diff <name1> <name2>`) is explicit.
 */
export function diffCommand(nameOrOnly: string, maybeOther?: string): void {
  let branchA: string;
  let branchB: string;

  if (maybeOther) {
    branchA = nameOrOnly;
    branchB = maybeOther;
  } else {
    const active = getActiveBranch();
    if (!active) {
      console.error('brg: no active branch — pass two branch names explicitly, or run "brg checkout" first.');
      process.exitCode = 1;
      return;
    }
    branchA = active;
    branchB = nameOrOnly;
  }

  for (const name of [branchA, branchB]) {
    if (!branchExists(name)) {
      console.error(`brg: no brg context tracked for branch "${name}".`);
      process.exitCode = 1;
      return;
    }
  }

  const entries = diffFacts(readFacts(branchA), readFacts(branchB));

  if (entries.length === 0) {
    console.log(dim(`No fact differences between "${branchA}" and "${branchB}".`));
    return;
  }

  console.log(`${bold(branchA)} → ${bold(branchB)}`);
  for (const entry of entries) {
    const key = `${entry.subject} ${entry.relation}`;
    if (entry.kind === 'added') {
      console.log(`  ${amber('+')} ${key}: ${entry.object}`);
    } else if (entry.kind === 'removed') {
      console.log(`  ${dim('-')} ${key}: ${entry.object}`);
    } else {
      console.log(`  ${amber('~')} ${key}: ${entry.from?.join(', ')} → ${entry.to?.join(', ')}`);
    }
  }
}

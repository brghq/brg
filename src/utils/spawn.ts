import spawn from 'cross-spawn';

// Node's built-in child_process.spawn talks directly to Windows'
// CreateProcess, which can't execute the .cmd/.ps1 shims npm uses for
// globally-installed CLIs (claude, gemini, codex, opencode, npm itself) —
// it fails with ENOENT even though the shim is right there on PATH.
// cross-spawn resolves those shims correctly (and safely quotes args)
// on Windows while behaving like a plain spawn everywhere else.

/**
 * Hands off the terminal to `command` with full stdio inheritance, then
 * exits this process with the child's exit code once it finishes. This is
 * "handoff mode" — brg does not stay in the loop after launch.
 */
export function handoff(command: string, args: string[] = []): void {
  const child = spawn(command, args, { stdio: 'inherit' });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(`brg: failed to launch "${command}": ${err.message}`);
    process.exit(1);
  });
}

/**
 * Runs `command` synchronously with inherited stdio (e.g. for install/login
 * flows the user needs to interact with) and returns its exit code.
 */
export function runInteractive(command: string, args: string[] = []): number {
  const result = spawn.sync(command, args, { stdio: 'inherit' });
  return result.status ?? 1;
}

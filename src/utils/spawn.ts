import { spawn, spawnSync } from 'node:child_process';

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
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return result.status ?? 1;
}

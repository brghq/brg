import { listSessions } from '../core/session.js';
import { isInitialized } from '../core/config.js';
import { amber, dim } from '../utils/style.js';

export function logCommand(): void {
  if (!isInitialized()) {
    console.error('brg: no .brg/ directory found. Run "brg init" first.');
    process.exitCode = 1;
    return;
  }

  const sessions = listSessions().reverse();
  if (sessions.length === 0) {
    console.log(dim('No checkpoints yet. Run "brg checkpoint <message>" to create one.'));
    return;
  }

  for (const s of sessions) {
    console.log(`${dim(s.timestamp)}  ${amber(s.tool)}  ${s.message}`);
  }
}

import fs from 'node:fs';
import { isInitialized, readConfig } from '../core/config.js';
import { contextPath } from '../core/context.js';
import { listSessions } from '../core/session.js';
import { dim } from '../utils/style.js';

function formatElapsed(since: Date): string {
  const ms = Date.now() - since.getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function statusCommand(): void {
  if (!isInitialized()) {
    console.log(dim('Not a brg project. Run "brg init" to get started.'));
    return;
  }

  const config = readConfig();
  const sessions = listSessions();
  const last = sessions[sessions.length - 1];

  const file = contextPath();
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = sessions.filter((s) => s.timestamp.slice(0, 10) === today).length;

  console.log(`active tool:       ${config.defaultTool ?? dim('(not set)')}`);
  console.log(`last checkpoint:   ${last ? formatElapsed(new Date(last.timestamp)) : dim('never')}`);
  console.log(`context.md size:   ${size} bytes`);
  console.log(`checkpoints today: ${todayCount}`);
}

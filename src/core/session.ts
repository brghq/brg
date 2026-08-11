import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { brgDir } from './config.js';

export interface SessionRecord {
  timestamp: string;
  tool: string;
  message: string;
  contextSnapshot: string;
}

export function sessionsDir(cwd: string = process.cwd()): string {
  return path.join(brgDir(cwd), 'sessions');
}

export function writeSession(record: SessionRecord, cwd: string = process.cwd()): string {
  const dir = sessionsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const safeTimestamp = record.timestamp.replace(/:/g, '-');
  // A timestamp alone can collide (two checkpoints in the same millisecond,
  // or concurrent brg invocations), silently overwriting a prior session
  // record. A short random suffix makes the filename unique without
  // changing the sortable timestamp prefix.
  const suffix = crypto.randomBytes(3).toString('hex');
  const file = path.join(dir, `${safeTimestamp}-${suffix}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  return file;
}

/**
 * Reads every session record. Checkpoints aren't written atomically, so a
 * crash mid-write (or hand-editing) can leave a file with broken JSON —
 * that file is skipped (with a warning) rather than throwing and taking
 * down every command that lists sessions (status, log, switch attribution)
 * over one bad file.
 */
export function listSessions(cwd: string = process.cwd()): SessionRecord[] {
  const dir = sessionsDir(cwd);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const records: SessionRecord[] = [];
  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      records.push(JSON.parse(raw) as SessionRecord);
    } catch {
      console.error(`brg: skipping unreadable session file ${filePath}`);
    }
  }
  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

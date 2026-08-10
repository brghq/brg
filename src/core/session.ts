import fs from 'node:fs';
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
  const file = path.join(dir, `${safeTimestamp}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  return file;
}

export function listSessions(cwd: string = process.cwd()): SessionRecord[] {
  const dir = sessionsDir(cwd);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const records = files.map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    return JSON.parse(raw) as SessionRecord;
  });
  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

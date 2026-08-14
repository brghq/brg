import fs from 'node:fs';
import crypto from 'node:crypto';
import { objectsDir, objectPath } from './paths.js';
import type { CheckpointObject, CheckpointObjectInput } from './types.js';

// Stable stringify: sorts object keys recursively so two logically
// identical inputs always serialize to the same bytes, regardless of
// property insertion order. Arrays keep their order (order is meaningful
// there — e.g. facts_delta).
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// Identical checkpoints (same parent/parents, same facts_delta, etc.) hash
// identically, giving deduplication for free — this is the property the
// design doc calls out as the point of content-addressing.
export function computeCheckpointId(input: CheckpointObjectInput): string {
  const hash = crypto.createHash('sha256').update(canonicalize(input)).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Writes a checkpoint object, computing its content-addressed id. If an
 * object with the same id already exists, it's left untouched (same
 * content, so overwriting would be a no-op) — this is what gives
 * deduplication for free.
 */
export function writeObject(
  input: CheckpointObjectInput,
  cwd: string = process.cwd(),
): CheckpointObject {
  const id = computeCheckpointId(input);
  const object: CheckpointObject = { ...input, id };
  const file = objectPath(id, cwd);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(objectsDir(cwd), { recursive: true });
    const tmpFile = `${file}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(object, null, 2), 'utf8');
    fs.renameSync(tmpFile, file);
  }
  return object;
}

/**
 * Reads a checkpoint object by id. Returns null for a missing or corrupt
 * file rather than throwing — callers that walk history (diff, merge,
 * `brg log --graph`) shouldn't crash over one bad object.
 */
export function readObject(id: string, cwd: string = process.cwd()): CheckpointObject | null {
  const file = objectPath(id, cwd);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as CheckpointObject;
  } catch {
    return null;
  }
}

export function objectExists(id: string, cwd: string = process.cwd()): boolean {
  return fs.existsSync(objectPath(id, cwd));
}

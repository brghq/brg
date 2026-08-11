import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildProgram } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

describe('brg --version', () => {
  it('reports the version from package.json', () => {
    const program = buildProgram();
    expect(program.version()).toBe(pkg.version);
  });
});

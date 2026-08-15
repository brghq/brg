import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createBranch } from '../src/versioning/branches.js';
import { recordCheckpoint, recordMergeCheckpoint } from '../src/versioning/checkpoint.js';
import { readObject } from '../src/versioning/objects.js';

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

describe('checkpoint objects — files_touched / git_commit_at_checkpoint', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-checkpoint-git-'));
    process.chdir(tmpDir);
    initGitRepo(tmpDir);
    createBranch('main', 'root');
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records the current git HEAD sha as git_commit_at_checkpoint', () => {
    const expectedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir }).toString().trim();

    const checkpoint = recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');

    expect(checkpoint.git_commit_at_checkpoint).toBe(expectedSha);
    expect(readObject(checkpoint.id)?.git_commit_at_checkpoint).toBe(expectedSha);
  });

  it('records dirty working-tree file paths as files_touched, paths only, no content', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'const x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'schema.sql'), 'CREATE TABLE x;\n');

    const checkpoint = recordCheckpoint('main', 'claude', 'added files', [], 'manual');

    expect(checkpoint.files_touched?.sort()).toEqual(['app.ts', 'schema.sql']);
    expect(JSON.stringify(checkpoint.files_touched)).not.toContain('const x');
    expect(JSON.stringify(checkpoint.files_touched)).not.toContain('CREATE TABLE');
  });

  it('never reports .brg/ itself as a touched file — recording the checkpoint necessarily dirties it', () => {
    const checkpoint = recordCheckpoint('main', 'claude', 'first checkpoint on a fresh repo', [], 'manual');
    expect(checkpoint.files_touched).toEqual([]);
  });

  it('files_touched is empty when the working tree is clean', () => {
    const checkpoint = recordCheckpoint('main', 'claude', 'no changes', [], 'manual');
    expect(checkpoint.files_touched).toEqual([]);
  });

  it('a modified (already-tracked) file is reported in files_touched', () => {
    fs.appendFileSync(path.join(tmpDir, 'README.md'), 'more text\n');

    const checkpoint = recordCheckpoint('main', 'claude', 'edited readme', [], 'manual');

    expect(checkpoint.files_touched).toEqual(['README.md']);
  });

  it('git_commit_at_checkpoint is null outside a git repo', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-nongit-checkpoint-'));
    process.chdir(nonGitDir);
    createBranch('main', 'root');

    const checkpoint = recordCheckpoint('main', 'claude', 'no git here', [], 'manual');

    expect(checkpoint.git_commit_at_checkpoint).toBeNull();
    expect(checkpoint.files_touched).toEqual([]);

    process.chdir(tmpDir);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('a merge checkpoint also carries git reference metadata', () => {
    createBranch('feature', 'a feature');
    recordCheckpoint('main', 'claude', 'm1', [], 'manual');
    recordCheckpoint('feature', 'claude', 'f1', [], 'manual');

    const merge = recordMergeCheckpoint('main', 'feature', 'claude', 'merged', []);

    expect(merge.git_commit_at_checkpoint).toMatch(/^[0-9a-f]{40}$/);
    expect(merge.files_touched).toEqual([]);
  });

  it('these fields are reference-only — never used to resolve which branch is active', () => {
    // Sanity check on the invariant itself: nothing in this codebase reads
    // git_commit_at_checkpoint or files_touched to decide branch scope —
    // recordCheckpoint always writes to the branch argument it's given,
    // regardless of what git reports.
    const checkpoint = recordCheckpoint('main', 'claude', 'did the thing', [], 'manual');
    expect(checkpoint.branch).toBe('main');
  });
});

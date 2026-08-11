import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('codex adapter transcript scoping', () => {
  let fakeHome: string;
  let project: string;
  let otherProject: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-codex-home-'));
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-codex-project-'));
    otherProject = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-codex-other-'));
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const sessionsDir = path.join(fakeHome, '.codex', 'sessions', '2026', '08', '11');
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Older session, matches our project.
    writeSession(path.join(sessionsDir, 'a.jsonl'), project, 'PROJECT-MATCH-CONTENT');
    // Newer session (by mtime), but a different project — must not be picked.
    writeSession(path.join(sessionsDir, 'b.jsonl'), otherProject, 'UNRELATED-CONTENT');
    fs.utimesSync(path.join(sessionsDir, 'b.jsonl'), new Date(), new Date(Date.now() + 60_000));
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(otherProject, { recursive: true, force: true });
    vi.resetModules();
  });

  function writeSession(file: string, cwd: string, marker: string, spaced = false): void {
    const line1 = spaced
      ? `{"type": "session_meta", "payload": {"cwd": ${JSON.stringify(cwd)}}}`
      : JSON.stringify({ type: 'session_meta', payload: { cwd } });
    const line2 = spaced
      ? `{"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "${marker}"}]}}`
      : JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: marker }],
          },
        });
    fs.writeFileSync(file, `${line1}\n${line2}\n`, 'utf8');
  }

  it('picks the session matching this project, not the most recently modified one', async () => {
    const { codex } = await import('../src/tools/codex.js');
    const extract = codex.getLatestTranscript!(project);
    expect(extract).not.toBeNull();
    expect(extract!.text).toContain('PROJECT-MATCH-CONTENT');
    expect(extract!.text).not.toContain('UNRELATED-CONTENT');
  });

  it('matches cwd even when the session_meta line uses spaced JSON formatting', async () => {
    const sessionsDir = path.join(fakeHome, '.codex', 'sessions', '2026', '08', '11');
    writeSession(path.join(sessionsDir, 'a.jsonl'), project, 'SPACED-MATCH-CONTENT', true);

    const { codex } = await import('../src/tools/codex.js');
    const extract = codex.getLatestTranscript!(project);
    expect(extract).not.toBeNull();
    expect(extract!.text).toContain('SPACED-MATCH-CONTENT');
  });

  it('returns null when no session matches this project', async () => {
    const { codex } = await import('../src/tools/codex.js');
    const extract = codex.getLatestTranscript!('/no/such/project');
    expect(extract).toBeNull();
  });
});

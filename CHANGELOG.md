# Changelog

All notable changes to `brg` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-08-11

### Added
- Real `ai-assisted` context strategy, replacing the previous stub: tries
  the active tool's own session summary (`--continue`/`resume --last`)
  first, falls back to reading that tool's on-disk transcript directly
  (no auth/quota needed) if that's unavailable, and falls back to a plain
  manual line as a last resort. Now the default `contextStrategy` for new
  projects (`manual` remains available and fully offline).
- Auto-checkpoint on `brg switch`: before handing off, captures the
  session you're leaving via the fallback chain above, so context isn't
  lost even if you switch tools without checkpointing first (e.g. right
  after the previous tool hit a quota limit). Never blocks the switch
  itself if it fails.
- `context.md` compaction: once the file passes a size threshold, older
  checkpoint entries roll into a single summary line, with a `.bak` of
  the pre-compaction file kept alongside it.
- `getLatestTranscript`/`summarizeViaSelf` added to the `ToolAdapter`
  interface (both optional) and implemented for `claude`/`codex`; a new
  `src/utils/transcript.ts` holds the generic, tool-agnostic JSONL
  reading logic they share.

### Changed
- **Scope: only Claude Code and Codex are supported for now.** Gemini CLI
  and OpenCode adapters were removed (`src/tools/gemini.ts`,
  `src/tools/opencode.ts`); the `ToolAdapter` interface and
  `tools/registry.ts` pattern make either a straightforward community
  contribution to add back later.
- `commands/checkpoint.ts` and `commands/switch.ts` now share checkpoint
  logic via a new `core/checkpoint.ts` instead of duplicating it.

## [0.1.1] - 2026-08-10

### Added
- Project logo and brand assets (`assets/`).
- `ROADMAP.md` outlining Phase 1 (shipped), Phase 2/3 (planned), and
  exploratory ideas.
- `docs/USER_GUIDE.md`: full command reference, concepts, configuration,
  common workflows, troubleshooting/FAQ, and uninstall instructions.

### Changed
- README rewritten: badges, real captured CLI output, full command
  reference table, "how it works" section.
- CI now skips the full test matrix on docs-only changes (`**.md`,
  `docs/**`, `assets/**`, `LICENSE`) via `paths-ignore`.

### Fixed
- **Windows: `brg switch` and `brg setup`'s install/login steps failed
  with `spawn <tool> ENOENT`**, even when `brg tools list` correctly
  showed the tool as installed. npm installs global CLIs on Windows as
  `.cmd`/`.ps1` shims, which Node's built-in `child_process.spawn` can't
  execute directly (it talks straight to `CreateProcess`, which only runs
  real executables) — only shell-aware lookups like `where` (used for
  detection) could find them. Switched to `cross-spawn`, which resolves
  Windows shims correctly. This affects every platform's install/login
  path too (`npm install -g ...`, `claude login`, etc.), not just
  `switch`.
- A checkpoint test left the process's cwd inside a directory it then
  tried to delete, which only failed on Windows (`EBUSY`) since POSIX
  allows removing your own cwd but Windows doesn't — CI was red on
  windows-latest as a result.

## [0.1.0] - 2026-08-10

### Added
- `brg setup`, `brg tools list`, `brg init`, `brg switch`, `brg checkpoint`,
  `brg log`, `brg status`, `brg context show` — the full Phase 1 MVP
  command surface.
- Tool adapter system (`src/tools/`) supporting Claude Code, Gemini CLI,
  Codex, and OpenCode.
- Manual context strategy (`src/context-strategies/manual.ts`) that logs
  checkpoints enriched with the current git branch/diffstat when available.
- Test suite (Vitest) and ESLint config.

### Changed
- Published to npm as `brg-cli` (the bare name `brg` is blocked by npm's
  package-name-similarity policy); the installed command is still `brg`.

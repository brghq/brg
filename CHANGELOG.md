# Changelog

All notable changes to `brg` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

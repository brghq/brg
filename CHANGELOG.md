# Changelog

All notable changes to `brg` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Project logo and brand assets (`assets/`).
- `ROADMAP.md` outlining Phase 1 (shipped), Phase 2/3 (planned), and
  exploratory ideas.

### Changed
- README rewritten: badges, real captured CLI output, full command
  reference table, "how it works" section.

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

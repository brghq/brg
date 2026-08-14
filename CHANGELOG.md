# Changelog

All notable changes to `brg` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
As of `26.8.3`, this project uses calendar versioning (`YY.M.patch`) instead
of Semantic Versioning.

## [Unreleased]

### Added
- Phase 2 context-versioning design doc (`docs/CONTEXT_VERSIONING.md`) —
  the decided architecture for context branching/diff/merge, linked from
  `ROADMAP.md`.
- `src/versioning/`: the underlying data model — content-addressed
  checkpoint objects, branch-scoped fact storage, and git-branch mapping
  (library code only, no command surface of its own).
- `brg branch <name> [--intent "..."]` — creates a brg context branch
  (`intent` required, prompted interactively if not passed via flag).
  Always created first and unconditionally — a matching real git branch
  is then asked about interactively (accept to create one, under the
  same name by default or a different one you type; decline to keep the
  brg branch context-only), auto-skipped outside a git repo. This is what
  lets you fork context to explore an angle without also forking git
  history.
- `brg checkout <name>` — switches to a brg branch and restores its
  context (intent, summary, recent checkpoints). Only runs `git checkout`
  if that brg branch has a linked git branch; a context-only branch
  switches in place, leaving the checked-out git branch untouched. If
  `<name>` isn't a tracked brg branch at all, falls back to a plain `git
  checkout` with a note.
- `.brg/refs/active` — tracks the currently active brg branch explicitly
  (set by `brg branch`/`brg checkout`), since a brg branch's git branch
  is now optional and can no longer always be inferred by asking git.
  `brg init` seeds a default active branch automatically (named after the
  checked-out git branch, or `main` outside a repo), backfilled
  idempotently on re-run for projects initialized before this existed.
- `brg init` now also installs an idempotent `post-checkout` git hook that
  flags plain `git checkout` usage landing on a branch with no brg context
  yet.
- `brg diff <branchA> <branchB>` — pure structural diff between two
  branches' fact sets (added/removed/changed triples), no LLM calls.
- `brg merge <source>` — merges a branch's brg context into the currently
  **active** brg branch (context-only, no `git merge` involved). Union
  merges automatically; candidate conflicts (same subject+relation,
  different object) go through interactive per-conflict resolution by
  default, or `--auto` to try the active tool as an LLM arbiter first
  (falling back to interactive per-conflict if it can't resolve one).
  Writes a two-parent merge checkpoint on success.
- `brg log --graph` — lane-based ASCII graph of checkpoint objects across
  every branch, in the style of `git log --graph` (merges always render
  correctly since brg's merge checkpoints only ever have exactly two
  parents, never an octopus merge). Without `--graph`, `brg log` behaves
  exactly as before.

### Changed
- User-facing messages ("already initialized", "not initialized yet",
  "branch already tracked") no longer reference the internal `.brg/`
  directory path — reworded in plain terms.

### Fixed
- `readLog` (branch checkpoint log) now skips a corrupt line with a
  warning instead of throwing, matching the tolerance already applied to
  `readFacts`/`readGitMap`.
- Codex's cwd-scoping check (`sessionMatchesCwd`) now tolerates spaced
  JSON formatting (`"cwd": "..."` as well as `"cwd":"..."`), found during
  a live sandbox verification pass against synthetic session files —
  real Codex output is compact JSON so this wasn't user-visible, but the
  strict substring/regex match was an unnecessary landmine.

## [26.8.3] - 2026-08-11

### Changed
- Adopted calendar versioning (`YY.M.patch`, e.g. `26.8.3`) in place of
  semver going forward.

### Fixed
- Explicit active-tool tracking (`config.yaml`'s `defaultTool`, set on
  every `brg switch`) replaces inferring "the tool being left" from the
  last checkpoint's `tool` field. The old approach misattributed
  auto-checkpoints across repeated switches (e.g. Claude → Codex → Claude
  would re-checkpoint against Claude instead of Codex the second time).
- `ai-assisted`'s local-transcript fallback (tier 2, the one requiring no
  auth/quota) now actually works for Codex: it previously expected Claude
  Code's `{ message: { role, content } }` JSONL shape only, so every
  Codex transcript line was silently skipped and checkpoints always fell
  through to the plain manual line.
- Transcript extraction now keeps the *end* of a session, not the start —
  a handoff needs the most recent decisions and state, not the opening
  prompt.
- Codex transcript lookup is now scoped to the current project's `cwd`
  (parsed from each session's own `session_meta` record) instead of
  picking the most recently modified session file process-wide, which
  could pull an unrelated project's conversation into context.
- `readContextForHandoff` now trims at checkpoint-entry boundaries instead
  of a raw character offset, so a truncated handoff never starts mid-line
  through a transcript excerpt.
- `listSessions`/`readConfig` no longer crash every command (status, log,
  switch) over one corrupted session file or invalid `config.yaml` — bad
  data is now skipped/defaulted with a warning instead of throwing.
- Session filenames now include a random suffix to avoid silently
  overwriting another checkpoint written in the same millisecond.

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

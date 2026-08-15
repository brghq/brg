# Changelog

All notable changes to `brg` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
As of `26.8.3`, this project uses calendar versioning (`YY.M.patch`) instead
of Semantic Versioning.

## [26.8.5] - 2026-08-15

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
- `contextText` field on checkpoint objects — the full generated text
  from a checkpoint's context strategy (tool self-summary, transcript
  excerpt, or a plain formatted line), carried forward permanently since
  it's what `summary.md` regeneration reads. `ContextStrategy.generate`
  now returns `{ text, source }` instead of a bare string, so a
  checkpoint's `source` field (`tool-summary`/`transcript-extract`/
  `manual`) reflects which tier actually produced it, instead of always
  being hardcoded to `manual`.
- `versioning/summary.ts`: `regenerateSummary` rebuilds a branch's
  `summary.md` from scratch from its checkpoint log on every checkpoint,
  bounded by a character budget. Deliberately not append-and-compact like
  the old `context.md` was — `objects/`+`log.jsonl` are already a
  durable, complete history, so `summary.md` can be a disposable,
  regenerated cache instead of something that itself needs careful
  compaction/backup bookkeeping.
- `brg mcp` — MCP server over stdio (new dependencies:
  `@modelcontextprotocol/sdk`, `zod`), exposing `context_search`,
  `context_commit`, `context_diff`, `context_merge`. Each tool wraps the
  same versioning data `brg branch`/`diff`/`merge`/`checkpoint` already
  use. `context_merge` can't prompt interactively (no TTY over MCP): it
  auto-merges anything with no conflict and returns real conflicts as
  data instead of committing; call it again with `resolutions` to finish.
- `plugin/` — a Claude Code plugin bundling brg's hooks and MCP server.
  `SessionStart` injects the active branch's `summary.md` as session
  context (skipped when the session started via `/clear`, respecting an
  explicit fresh-slate request); `PreCompact` checkpoints before Claude
  Code wipes context, attributed to `config.defaultTool` or falling back
  to `claude`. Both are backed by new `brg hook <event>` subcommands
  (`session-start`, `pre-compact` — see `src/commands/hook.ts`), never
  block their respective Claude Code event on failure. `.mcp.json`
  registers `brg mcp` as the plugin's MCP server. Codex has no equivalent
  plugin system yet, so this targets Claude Code only.
- `brg dashboard [--port <n>]` — local web dashboard over `.brg/`, zero
  new dependencies (`node:http`). Branch graph rendered as SVG (branches
  as horizontal lanes, oldest-to-newest left to right); clicking a
  checkpoint node shows its `facts_delta` as add/remove lines in an
  inspector panel — reuses the delta already stored on the checkpoint
  object rather than computing a separate diff. Every request reads
  `.brg/` fresh (no caching, no database, no in-memory state). Brand
  palette, typography, and the real logo mark per CLAUDE.md (paper/ink/
  amber, JetBrains Mono). Stat row shows an estimated token count
  (chars/4, labeled "(est.)") for the active branch's summary, alongside
  branch/checkpoint counts — no fabricated cache-hit-rate stat, since brg
  has no way to know what happens inside a real API call.
- `versioning/graph-svg.ts`: server-side SVG rendering of the branch
  graph, factored out so `brg dashboard` and `brg export` share one
  rendering instead of two. The dashboard now fetches pre-rendered markup
  from `/api/graph.svg` and layers click handlers on it, rather than
  building the SVG client-side.
- `brg export [--branch <name>] [--format md|html] [--out <path>]` —
  free, local, no-account snapshot of a branch's context: intent,
  chronological decision log (message + `facts_delta` per checkpoint),
  and a facts table. Defaults to the active branch, Markdown format, and
  `brg-export-<branch>.<format>`. HTML output is self-contained and
  additionally embeds the branch graph as inline SVG (via
  `graph-svg.ts`); notes print-to-PDF as the alternative rather than
  bundling a PDF renderer.
- Structured fact extraction — two paths, no new dependency or API key
  (reuses `ToolAdapter.summarizeViaSelf`/MCP, same principle as every
  other AI-touching part of brg):
  - `ai-assisted`'s tier 1 now requests a **combined** summary+facts JSON
    response from the active tool in one call (previously summary only),
    fed the branch's current facts so it reports only what's new. Falls
    back to the raw response as plain summary text (facts empty) if the
    model doesn't return valid JSON — never blocks a checkpoint.
    `context-strategies/parse-facts-response.ts` tolerantly parses it
    (strips markdown code fences, drops individually-malformed fact
    entries). `manual` and ai-assisted's tiers 2/3 always produce
    `factsDelta: []`. `ContextStrategy.generate` now takes the branch's
    existing facts as a third argument and returns `factsDelta`
    alongside `text`/`source`.
  - `brg mcp`'s `context_commit` gains an optional `facts` array, letting
    an MCP-connected agent push structured facts directly from its own
    live understanding in the same call as its checkpoint message —
    zero extra LLM calls. Records with the new `source: 'mcp-agent'`
    when facts are provided, `'manual'` otherwise.
  - `core/checkpoint.ts`'s `performCheckpoint` (shared by `brg
    checkpoint`, `brg switch`'s auto-checkpoint, and the plugin's
    `PreCompact` hook) now reads the branch's existing facts and passes
    the strategy's extracted `factsDelta` through to `recordCheckpoint`
    instead of always `[]`.

### Changed
- User-facing messages ("already initialized", "not initialized yet",
  "branch already tracked") no longer reference the internal `.brg/`
  directory path — reworded in plain terms.
- **`brg checkpoint`, `brg switch`, `brg status`, `brg context show`, and
  `brg log` now run entirely on the branch-scoped versioning data model**
  instead of Phase 1's flat `context.md`/`sessions/*.json`:
  - `brg switch` hands off the active branch's `summary.md` instead of
    `context.md`.
  - `brg status` shows active branch, `summary.md` size, and
    branch-scoped checkpoint count instead of `context.md` size and a
    global session count.
  - `brg context show` prints the active branch's `summary.md` instead
    of `context.md`.
  - `brg log` (without `--graph`) now lists every branch's checkpoints
    together, flat and chronological, sourced from checkpoint objects
    instead of `sessions/*.json` — same shape as before, new source.
  - `brg checkpoint`/`brg switch` now error cleanly ("no active branch")
    instead of silently degrading, since there's no longer a
    context.md/session fallback path to degrade to — unreachable in
    normal use since `brg init` always seeds an active branch.

### Removed
- **`context.md` and `sessions/*.json` (Phase 1's own storage) are
  retired and deleted** — `src/core/context.ts` and `src/core/session.ts`
  no longer exist. This storage was fully redundant with the
  branch-scoped versioning data (mostly the same information, duplicated
  in two formats) once every command that read/wrote it was switched
  over to Phase 2 storage instead. Pre-1.0, no migration path is
  provided — this is a clean break, not a deprecation.

### Fixed
- `readLog` (branch checkpoint log) now skips a corrupt line with a
  warning instead of throwing, matching the tolerance already applied to
  `readFacts`/`readGitMap`.
- Codex's cwd-scoping check (`sessionMatchesCwd`) now tolerates spaced
  JSON formatting (`"cwd": "..."` as well as `"cwd":"..."`), found during
  a live sandbox verification pass against synthetic session files —
  real Codex output is compact JSON so this wasn't user-visible, but the
  strict substring/regex match was an unnecessary landmine.
- **Audit against the "Context Branch vs Git Branch" invariant** (the
  active brg branch, `.brg/refs/active`, must always be the source of
  truth for context; the checked-out git branch is metadata/reference
  only and must never be used to resolve or auto-switch context) found
  and fixed six gaps between that spec and actual behavior:
  - `brg branch` and `brg checkout` are merged into a single `brg
    checkout <name>` command — creates and switches on a new name,
    switches only (never errors, never re-prompts) on an existing one.
    New `--inherit`/`--orphan` and `--git`/`--no-git`/`--git=<name>`
    flags skip the interactive prompts these previously always required.
  - Checkpoint objects gained `files_touched` (working-tree paths from
    `git status --porcelain`, paths only, no diff/file content, `.brg/`
    itself always excluded) and `git_commit_at_checkpoint` (`git
    rev-parse HEAD`) — both `null`/`[]` outside a git repo or on any git
    error, reference-only and never consulted to resolve branch scope.
  - `brg log` now defaults to the active branch only; `--all` lists
    every branch flat and tagged; `--graph` scopes to the active branch
    by default and takes `--all` for the full cross-branch graph
    (previously it always showed every branch, with no way to scope to
    just the active one).
  - `brg status` now prints the actual checked-out git branch as its own
    field, and warns (without acting) when it has no linked git branch
    or diverges from the active brg branch's linked one.
  - `brg diff <name>` gained a one-argument form (active branch vs
    `<name>`), alongside the existing two-argument `brg diff <a> <b>`.
  - `context_commit`'s MCP tool schema dropped its `branch` override
    parameter — it always writes to the active brg branch now, so a
    connected agent can't silently target a different one; `context_diff`
    gained an optional `branchA` (defaulting to active) to match.
  - Six other spec sections (checkpoint attribution, merge target
    resolution, the `post-checkout` hook, `brg init`'s active-branch
    seeding, `context_search`/`context_merge`'s branch defaulting, and
    `brg export`'s branch defaulting) were checked against the spec and
    confirmed already compliant — no change needed.

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

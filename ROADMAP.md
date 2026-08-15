# Roadmap

`brg` is pre-1.0 and evolving. This page tracks what's shipped, what's
planned, and what's exploratory — so it's clear what you can rely on today
versus what's still an idea.

## Phase 1 — Shipped, now running on Phase 2 storage

The core "carry context between AI CLIs" workflow, in handoff mode:

- `brg setup` — interactive, idempotent install/auth wizard
- `brg tools list` — installed/authenticated status per tool
- `brg init` — create `.brg/` in a project, activate a default branch
- `brg switch <tool>` (`-f`/`--fresh` to skip context) — hand off to an AI CLI
- `brg checkpoint "message"` — snapshot state, git-commit style
- `brg log` — checkpoint timeline for the active branch, newest first
  (`--all` for every branch, `--graph` for a graph view — see Phase 2)
- `brg status` — active branch/tool, last checkpoint, summary size, today's count
- `brg context show` — print the active branch's rolling summary

Supported tools: Claude Code, Codex (additional adapters — Gemini CLI,
OpenCode, others — are a natural community contribution via the
`ToolAdapter` interface).

**Architecture note:** these commands originally wrote to a flat
`context.md` + `sessions/*.json` (Phase 1's own storage, predating
branches). That storage has been **retired and deleted** — it was fully
redundant with the branch-scoped versioning data below, and duplicating
history in two formats wasn't worth maintaining. All of the above now run
entirely on Phase 2 storage:
- Auto-checkpoint on `brg switch` and the explicit `brg checkpoint`
  command both go through `core/checkpoint.ts`'s `performCheckpoint`,
  which generates text via the tiered fallback strategy (self-summarize →
  transcript extract → manual message, see `context-strategies/`) and
  records it on the active branch via `versioning/checkpoint.ts`'s
  `recordCheckpoint`.
- Each branch's `summary.md` is **fully regenerated** from its checkpoint
  log on every checkpoint (see `versioning/summary.ts`) — a disposable,
  bounded-size cache, not a source of truth (the source of truth is
  `objects/` + `log.jsonl`, which are already durable and complete). No
  append/compact/`.bak` bookkeeping needed, unlike the old `context.md`.
  This is what `brg switch`/`brg status`/`brg context show` read.

## Phase 2 — Shipped

Context branching and richer session awareness, all shipped on
`feature/phase-2`. Full design (data model, git integration, merge
engine, MCP/plugin surface, build sequence) lives in
[docs/CONTEXT_VERSIONING.md](./docs/CONTEXT_VERSIONING.md); full usage
and flags for every command below live in
[docs/USER_GUIDE.md](./docs/USER_GUIDE.md#command-reference) — this list
is status tracking only, not a second copy of either.

| Piece | Status |
|---|---|
| `brg checkout <name>` — create/switch brg context branches, replacing the old `brg branch` | Shipped |
| `brg diff` — structural diff between two branches' fact sets | Shipped (branch-vs-branch only; checkpoint-level diff via history replay is a later extension) |
| `brg show <checkpoint-id>` — inspect a single checkpoint | Not started |
| `brg merge <source>` — union + conflict resolution, writes a merge checkpoint | Shipped |
| `brg log --graph` — branch-graph rendering | Shipped |
| `brg mcp` — MCP server (`context_search`/`commit`/`diff`/`merge`) | Shipped |
| Claude Code plugin (`plugin/`) — `SessionStart`/`PreCompact` hooks + bundled `brg mcp` | Shipped — see [plugin/README.md](./plugin/README.md) |
| `brg dashboard` — local web dashboard over `.brg/` | Shipped |
| `brg export` — Markdown/HTML branch snapshot | Shipped |
| Structured fact extraction — feeds `facts.json`, which `brg diff`/`brg merge` compare | Shipped |
| `brg doctor` — diagnose a broken `.brg/` setup or misconfigured tool | Not started |
| `brg run --all` — fan a prompt out to multiple tools in parallel | Not started |
| Wrapper mode (opt-in) — `brg` stays resident instead of handing off and exiting | Not started — not expected to be *required* for context capture, since Phase 1's auto-checkpoint fallback chain already covers the case it was meant to solve; handoff mode stays available regardless |

## Phase 3 — Planned

- `brg sync push` / `brg sync pull` — cloud sync for context across
  machines (part of a future paid tier; the CLI itself stays free and
  open-source forever)
- `brg ask` — query project context without switching tools
- `brg config` — first-class config management from the CLI instead of
  hand-editing `config.yaml`

## Beyond — Exploratory

Ideas under consideration, not committed to:

- A desktop GUI for people who'd rather browse context/checkpoints
  visually than through the CLI
- Team features on top of cloud sync (shared project context)

No dates are attached to anything beyond Phase 1 — phases represent
sequencing intent, not a schedule.

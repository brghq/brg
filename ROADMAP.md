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
- `brg log` — checkpoint timeline (every branch, flat, newest first)
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

## Phase 2 — Core shipped, three pieces remain

Context branching and richer session awareness. The design for context
branching/diff/merge is decided — see
[docs/CONTEXT_VERSIONING.md](./docs/CONTEXT_VERSIONING.md) for the full
architecture (data model, git integration, merge engine, MCP/plugin
surface, and build sequence). It still ships one piece at a time, each
scoped in its own discussion before work starts — this roadmap entry
tracks status, the linked doc is the source of truth for design.

**Structured fact extraction is not built yet, and not yet scheduled.**
`facts_delta` is always empty on every checkpoint today — no code decides
"what fact changed" from a checkpoint's content, since that needs an LLM
call and is deliberately separate, later work (see the design doc's
Capture section). Until it exists, `brg diff`/`brg merge` have nothing
real to compare (facts.json is always `[]`), even though the timeline
(`brg log`, `summary.md`, checkpoint objects) is fully real and populated.
This is the single highest-value piece of remaining work — everything
else in Phase 2 either already works end-to-end or is a display layer
over data that's still empty.

- `brg branch <name>` / `brg checkout <name>` — `brg branch` always
  creates the brg context branch first; a matching git branch is optional
  (asked interactively afterward, skippable, auto-skipped outside a git
  repo), so you can fork context to explore an angle without forking git
  history. `brg checkout` only runs `git checkout` if that brg branch has
  a linked git branch; otherwise it switches brg's active context in
  place. A `post-checkout` hook (installed by `brg init`) is a safety net
  for plain `git checkout` outside brg. **Status: shipped on
  `feature/phase-2`** (name-only MVP — full flag passthrough from the
  design doc is a later extension).
- `brg diff` — pure structural diff between two branches' or checkpoints'
  fact sets, no LLM calls. **Status: shipped on `feature/phase-2`**
  (branch-vs-branch only; checkpoint-level diff via history replay is a
  later extension). `brg show <checkpoint-id>` inspects a single
  checkpoint — **not started**.
- `brg merge <source>` — union facts automatically, flag `(subject,
  relation)` conflicts for human-in-the-loop resolution by default
  (`--auto` tries the active tool as an LLM arbiter first, falling back
  to human resolution per-conflict if unavailable/unparseable), writes a
  two-parent merge checkpoint on the currently **active brg branch**
  (`.brg/refs/active` — not necessarily the checked-out git branch).
  **Status: shipped on `feature/phase-2`** (context-only — does not run
  `git merge`; run that yourself for the code side).
- `brg log --graph` — CLI rendering of the branch graph (checkpoint
  objects across every branch, lane-based like `git log --graph`) over
  the same data the dashboard and export reuse. **Status: shipped on
  `feature/phase-2`.**
- `brg mcp` — MCP server over stdio exposing `context_search`,
  `context_commit`, `context_diff`, `context_merge`; each tool is a thin
  wrapper over `src/mcp/tools.ts`, which works against the same
  versioning data `brg branch`/`diff`/`merge`/`checkpoint` already use —
  no separate data path. `context_merge` can't prompt interactively (no
  TTY over MCP): it auto-merges anything with no conflict, and returns
  real conflicts as data (target/source values per subject+relation)
  instead of committing — the calling agent decides and calls again with
  `resolutions` filled in to finish. **Status: shipped on
  `feature/phase-2`.**
- Claude Code plugin (`plugin/`) — `SessionStart` injects the active
  branch's rolling summary as session context (skipped on `/clear`, so an
  explicit fresh-slate request isn't fought), `PreCompact` checkpoints
  before Claude Code wipes context, plus `brg mcp` bundled via
  `plugin/.mcp.json` for on-demand deeper search. Both hooks are thin
  `brg hook <event>` calls into the installed CLI — see
  [`plugin/README.md`](./plugin/README.md). Codex has no equivalent
  plugin/hook system today, so this targets Claude Code only, same
  scoping as the `ToolAdapter` interface. **Status: shipped on
  `feature/phase-2`.**
- `brg dashboard` — local static server over `.brg/`, branch graph plus a
  per-checkpoint diff inspector; no database, no cloud dependency.
  **Status: not started.**
- `brg export [--branch <name>] [--format md|html] [--out <path>]` — free,
  local, no-account snapshot of a branch's context to hand a teammate;
  Markdown or self-contained HTML only (no bundled PDF renderer — use the
  browser's print-to-PDF on the HTML export). **Status: not started.**
- **Structured fact extraction** — deliberately sequenced **last** in
  Phase 2, after everything above. An incremental, LLM-driven step at
  checkpoint time that decides what `facts_delta` a checkpoint should
  carry (per the design doc's Capture section), so `facts.json` stops
  being permanently empty and `brg diff`/`brg merge` have real facts to
  work with. It's the highest-*value* piece but also the riskiest/most
  complex (LLM cost, accuracy, failure-mode design) — plugin/dashboard/
  export are comparatively mechanical display layers over data that
  already exists, so they go first. **Status: not started, not yet
  scoped** — needs its own scoping discussion before work starts.
- `brg doctor` — diagnose a broken `.brg/` setup or misconfigured tool
- `brg run --all` — fan a prompt out to multiple tools in parallel
- **Wrapper mode** (opt-in) — instead of handing off and exiting, `brg`
  stays in the loop: live session tracking and multi-agent orchestration
  across tools. (Auto-checkpointing itself already shipped in Phase 1 —
  it doesn't need `brg` to stay resident, since both Claude Code and
  Codex persist their own transcripts to disk continuously, so `brg` can
  reconstruct a session after the fact without watching it live.) Handoff
  mode (today's default) stays available regardless.

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

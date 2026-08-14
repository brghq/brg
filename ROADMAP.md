# Roadmap

`brg` is pre-1.0 and evolving. This page tracks what's shipped, what's
planned, and what's exploratory — so it's clear what you can rely on today
versus what's still an idea.

## Phase 1 — Shipped (current, `0.1.0`)

The core "carry context between AI CLIs" workflow, in handoff mode:

- `brg setup` — interactive, idempotent install/auth wizard
- `brg tools list` — installed/authenticated status per tool
- `brg init` — create `.brg/` in a project
- `brg switch <tool>` (`-f`/`--fresh` to skip context) — hand off to an AI CLI
- `brg checkpoint "message"` — snapshot state, git-commit style
- `brg log` — checkpoint timeline
- `brg status` — active tool, last checkpoint, context size, today's count
- `brg context show` — print the raw context file
- Auto-checkpoint on `brg switch` — before handing off, captures the
  session you're leaving via a tiered fallback chain (self-summarize →
  raw transcript extract → manual message), so you don't lose anything
  even if you switch without checkpointing first
- Rule-based `context.md` compaction — older checkpoints roll into a
  single summary line once the file passes a size threshold, so it stays
  bounded as a project's history grows

Supported tools: Claude Code, Codex (additional adapters — Gemini CLI,
OpenCode, others — are a natural community contribution via the
`ToolAdapter` interface).

## Phase 2 — Planned

Context branching and richer session awareness. The design for context
branching/diff/merge is decided — see
[docs/CONTEXT_VERSIONING.md](./docs/CONTEXT_VERSIONING.md) for the full
architecture (data model, git integration, merge engine, MCP/plugin
surface, and build sequence). It still ships one piece at a time, each
scoped in its own discussion before work starts — this roadmap entry
tracks status, the linked doc is the source of truth for design.

- `brg branch <name>` / `brg checkout <name>` — thin wrapper around real
  `git branch`/`git checkout` that also creates/restores a matching
  git-ref-keyed context history (`.brg/branches/<name>/`), plus a
  `post-checkout` hook as a safety net for plain `git checkout` outside
  brg. **Status: shipped on `feature/phase-2`** (name-only MVP — full
  flag passthrough from the design doc is a later extension).
- `brg diff` — pure structural diff between two branches' or checkpoints'
  fact sets, no LLM calls. `brg show <checkpoint-id>` inspects a single
  checkpoint. **Status: not started.**
- `brg merge` — union facts automatically, flag `(subject, relation)`
  conflicts for human-in-the-loop resolution by default (LLM-arbiter
  auto-resolve is opt-in, never default), write a two-parent merge
  checkpoint. **Status: not started.**
- `brg log --graph` — CLI rendering of the branch graph over the same
  data the dashboard and export reuse. **Status: not started.**
- MCP server (`context_search`, `context_commit`, `context_diff`,
  `context_merge`) — small, deliberate surface wired into the existing
  `ToolAdapter` pattern. **Status: not started.**
- Claude Code / Codex plugin — `SessionStart`/`PreCompact` hooks for
  guaranteed context injection and pre-wipe checkpointing, plus the MCP
  tools above for on-demand deeper search. **Status: not started.**
- `brg dashboard` — local static server over `.brg/`, branch graph plus a
  per-checkpoint diff inspector; no database, no cloud dependency.
  **Status: not started.**
- `brg export [--branch <name>] [--format md|html] [--out <path>]` — free,
  local, no-account snapshot of a branch's context to hand a teammate;
  Markdown or self-contained HTML only (no bundled PDF renderer — use the
  browser's print-to-PDF on the HTML export). **Status: not started.**
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

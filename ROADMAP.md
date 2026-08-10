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

Context branching and richer session awareness:

- `brg branch` / `brg checkout` / `brg merge` — divert and reconcile
  context lines the way git branches diverge and merge, for exploring an
  approach without polluting the main context history
- `brg diff` / `brg show <checkpoint-id>` — inspect what changed between
  checkpoints
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

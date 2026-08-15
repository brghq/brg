# Context Versioning Architecture (Phase 2 design)

This document is the detailed technical design behind the Phase 2 items in
[`ROADMAP.md`](../ROADMAP.md) — `brg checkout` / `brg merge` / `brg diff`.
It exists so implementation can start directly from this file
without re-deriving the reasoning behind it.

Status: **decided**, after discussion — this is the design Phase 2 work
should follow. It ships one piece at a time (see "Suggested build
sequence" below), and each piece still goes through its own scoping
discussion before implementation starts; this document fixes the
architecture, not the schedule.

Grounded in: `ContextBranch` (arXiv 2512.13914), `Git Context Controller`
(arXiv 2508.00031), and a prior-art check of existing branch-scoped context
tools (see project research notes, kept outside this repo). Neither paper
ties branching to real git refs, and neither implements real merge — those
two gaps are what this design fills in.

## Design principles

1. **Never replace what git already does.** brg does not fork or shadow git
   branches — it attaches a parallel, git-ref-keyed context history to
   branches that already exist.
2. **LLM calls are the exception, not the rule.** Only two call sites are
   allowed to hit a model: incremental fact extraction at commit time, and
   conflict resolution for facts flagged as contradictory at merge time.
   Diffing, checkpoint storage, branch switching, and most of merging are
   pure data operations — zero LLM calls.
3. **Restore is lazy.** Checking out a branch loads that branch's rolling
   summary plus a small window of recent checkpoints — never a full replay
   of history. This is what keeps token cost bounded as history grows.
4. **The CLI, the plugin, and the dashboard render one dataset.** All three
   read `.brg/` directly. No feature should require the other two surfaces
   to be present.

## Data model

```
.brg/
  objects/
    <sha256>.json            # immutable checkpoint, content-addressed
  branches/
    <branch-name>/
      intent.md              # restated goal for this branch, set at creation
      summary.md             # regenerated rolling summary (bounded size)
      facts.json             # structured fact store, see schema below
      log.jsonl               # append-only list of checkpoint ids, newest last
  refs/
    git-map.json             # git branch/commit -> brg branch resolution
  config.yaml
```

### Checkpoint object (`objects/<sha256>.json`)

```json
{
  "id": "sha256:...",
  "parent": "sha256:... | null",
  "branch": "feature-payments",
  "tool": "claude-code",
  "timestamp": "2026-08-15T10:22:00Z",
  "message": "chose Stripe over Razorpay for webhooks",
  "facts_delta": [
    { "op": "add", "subject": "payments", "relation": "provider", "object": "stripe" },
    { "op": "remove", "subject": "payments", "relation": "provider", "object": "undecided" }
  ],
  "source": "tool-summary | transcript-extract | manual"
}
```

`id` is `SHA256` of the canonical serialization of this object minus `id`
itself — identical checkpoints (same parent, same facts_delta) hash
identically, giving deduplication for free, per the `ContextBranch` pattern.

### Fact (`branches/<name>/facts.json`)

```json
{ "subject": "payments", "relation": "provider", "object": "stripe",
  "checkpoint": "sha256:...", "confidence": "stated" }
```

Facts are the unit diff and merge operate on — not raw messages, not full
transcripts. `subject`/`relation` together form the conflict key: two facts
with the same key and different `object` are a candidate conflict.

### Git mapping (`refs/git-map.json`) — optional per branch

```json
{ "feature-payments": { "git_branch": "payments-work", "created_from_sha": "1d0e88..." } }
```

A brg branch's git branch is **optional**, and can have a different name
than the brg branch itself (`git_branch` above deliberately differs from
the key). Not every context fork needs a git fork: exploring a different
angle on the same code without polluting the existing context thread is a
legitimate reason to create a brg branch with no git branch at all. A brg
branch with no entry here is a pure context branch.

### Active branch (`refs/active`)

Plain text file holding the name of the currently active brg branch.
Because a brg branch's git branch is optional, "which brg branch is
current" can no longer always be derived by asking git and looking it up
in the git map — a context-only branch has nothing for git to tell us.
This file is the explicit source of truth instead, set by `brg checkout`,
read by `brg merge` and anything else keyed off "the branch I'm currently
working in." `brg init` seeds it with a default branch (named after the
checked-out git branch, or `main` outside a repo) so there's never a
project with no active branch. This is the invariant the rest of the CLI
is held to: **the active brg branch is always the source of truth for
context; the checked-out git branch is metadata/reference only**, and is
never used to resolve or auto-switch context — `brg status` reports a
mismatch instead of acting on it.

## Git integration

Two layers, not one — see the reasoning in the research notes for why
neither alone is sufficient:

- **Primary: `brg checkout <name>`.** A single command for both creating
  and switching brg context branches — there is no separate `brg branch`.
  If `<name>` doesn't exist yet, creating the brg branch is the primary,
  unconditional action, and it never depends on git. A matching real git
  branch is asked about afterward, interactively (`--git`/`--no-git`/
  `--git=<name>` skip the prompt; auto-skipped outside a git repo): accept
  to create one (same name by default, or a different one you type),
  decline to keep the brg branch context-only. If `<name>` already
  exists, `brg checkout <name>` just switches to it — never an error,
  never re-prompts — and only runs `git checkout` if that brg branch has
  a git-map entry; otherwise it switches brg's active context in place,
  leaving the checked-out git branch untouched. Declining/checkout-only
  never blocks or degrades the brg-side operation — git involvement is
  additive, never required.
- **Safety net: `post-checkout` hook**, installed by `brg init`. Fires when
  someone uses plain `git checkout` outside brg (another terminal, an IDE).
  Does not do a full rich restore — just flags staleness (`brg: context
  out of sync, run 'brg sync'`) or does a quiet best-effort reconcile.

## Capture (what triggers a checkpoint, and how it stays cheap)

**Status: shipped**, including structured fact extraction, via two
complementary paths:

- **Reliable path** (`brg checkpoint`, `brg switch`'s auto-checkpoint, the
  plugin's `PreCompact` hook — all going through
  `core/checkpoint.ts`'s `performCheckpoint`): the tiered fallback
  (tool's own `--continue`/`resume --last` summary first → raw transcript
  extract → manual message) now requests summary **and** facts together
  in tier 1's single call, rather than a second call — see
  `context-strategies/ai-assisted.ts` and `parse-facts-response.ts`. This
  fires unconditionally at every checkpoint boundary brg itself controls.
- **Opportunistic path** (`brg mcp`'s `context_commit`): an MCP-connected
  agent can push structured facts directly, from its own live
  understanding, in the same call as its checkpoint message — zero extra
  LLM calls. Model-discretionary (the agent has to choose to call it),
  so it's additive on top of the reliable path, never a replacement for
  it.

Both paths write through the same `recordCheckpoint` — see Data model
above. Original design notes, still accurate:

- **Incremental** — only the delta since the last checkpoint is sent to the
  model, never the full session.
- **Triggered at natural boundaries** — `brg checkpoint`, `brg switch`, and
  `PreCompact` — not on every turn.

## Diff engine

Pure structural comparison, no LLM calls: given two branches (or two
checkpoints), diff their `facts.json` sets. Output is a graph diff —
added/removed/changed `(subject, relation, object)` triples. This is the
same shape `brg diff` and the dashboard's inspector panel both render.

## Merge engine

The one piece neither reference paper solves — treat it as the actual
build target, not a reused pattern.

1. **Union** — facts present in only one branch, or identical in both, merge
   automatically. No LLM call.
2. **Candidate conflicts** — same `(subject, relation)`, different `object`.
   Cheap string/structural match, still no LLM call.
3. **Resolution** — only candidate conflicts reach a resolution step.
   Default: human-in-the-loop, shown as a merge hunk (CLI prompt today,
   dashboard click-to-resolve once it exists). LLM-arbiter auto-resolve is
   opt-in, never default.
4. **Merge commit** — a checkpoint object with two `parent` ids (extend the
   schema above to `parents: [idA, idB]` for merge checkpoints specifically).

## MCP server surface

Shipped as `brg mcp` — a standalone stdio server (`@modelcontextprotocol/
sdk` + `zod`), not gated on the plugin (module 7) existing; the plugin
bundles this same server rather than building a separate one. Deliberately
small — a bloated tool surface eats the same context window this whole
system exists to protect:

- `context_search` — a brg branch's intent, summary, facts, and recent
  checkpoints; defaults to the currently active branch, optional `query`
  substring-filters facts
- `context_commit` — record a checkpoint on the active brg branch, same
  tiered fact-capture behavior as `brg checkpoint` (see Capture above).
  Always writes to `.brg/refs/active`'s branch; there is no `branch`
  parameter to target a different one — a deliberate choice so an
  MCP-connected agent can never silently write context onto a branch
  other than the one the user has selected
- `context_diff` — structural diff between two branches' facts, same
  engine as `brg diff`
- `context_merge` — attempt a merge into the target (defaults to active
  branch); facts with no conflict merge and commit immediately. A real
  conflict is **not** committed — it's returned as data (`{ subject,
  relation, target: [...], source: [...] }`) instead of resolved, since
  there's no TTY over MCP for the interactive prompt `brg merge` uses.
  The calling agent (not brg) decides — by asking its own user, or
  reasoning on its own — then calls `context_merge` again with
  `resolutions: [{ subject, relation, choice }]` filled in to finish.
  Stateless on brg's side: no partial-merge state is held between the
  two calls, the second call just re-runs the union merge and applies
  the given resolutions on top.

Each call returns a small JSON summary, not raw stored data — heavy
lifting (diff computation, conflict detection) happens in the local brg
process, not inside the tool call payload.

## Plugin (Claude Code / Codex integration)

Two kinds of integration point, with different guarantees:

- **Hooks (guaranteed, no model discretion)**: `SessionStart` — inject
  current branch's `summary.md`. `PreCompact` — checkpoint before context
  is wiped. This is the reliable path and should carry the bulk of the
  value.
- **MCP tools (model-discretionary)**: available for on-demand deeper
  search, nudged via tool descriptions and system instructions, never
  relied on as the only path to correctness.

## Dashboard

`brg dashboard` starts a local static server reading `.brg/` directly — no
separate database, no cloud dependency for the local case. Renders the same
branch graph as `brg log --graph`, plus a clickable inspector for
per-checkpoint diffs. Cloud sync (Phase 3) is additive on top of this, not
a prerequisite for it.

## Export

`brg export [--branch <name>] [--format md|html] [--out <path>]`

The free, local, no-account alternative to cloud sharing (Phase 3). Someone
who doesn't want cloud sync should still be able to hand a teammate a
readable snapshot of a branch's context — the way you'd share a Google Doc,
without either side needing brg installed to read it.

- **Content**: branch intent, the decision log rendered as prose
  (chronological, one entry per checkpoint — message plus the facts it
  changed), and a facts table. HTML output additionally embeds the branch
  graph as inline SVG (the same rendering the dashboard uses).
- **Formats, deliberately limited to two**: Markdown (zero dependency,
  direct render of `.brg/` data, stays git-diffable) and a self-contained
  HTML file (zero dependency — no headless browser, no PDF library; the
  SVG graph is embedded inline the same way the dashboard does it). PDF is
  *not* generated by brg itself — a bundled PDF renderer (Puppeteer or
  similar) is a heavy dependency for a rarely-used path. Point people at
  their browser's own print-to-PDF on the HTML export instead: same output
  quality, zero added dependency.
- **Reuses, doesn't duplicate**: export is a fourth renderer over the exact
  same `.brg/` data the CLI graph, the plugin, and the dashboard already
  read — no separate export-specific data path to maintain.

## Suggested build sequence

1. Data model + `objects/`/`branches/` read-write, no branching logic yet —
   get the schema right first, everything else depends on it.
2. `brg checkout` (create + switch, unified) wrapping real git, with the
   safety-net hook.
3. `brg diff` — pure structural diff, no LLM involvement, easiest correctness
   win.
4. `brg merge` — union + conflict-flagging first (no LLM), human-resolution
   UX second, LLM-arbiter last.
5. `brg log --graph` — CLI graph rendering.
6. MCP server — small surface, wired into the existing `ToolAdapter`
   pattern.
7. Plugin packaging (hooks + MCP bundled) for Claude Code, mirroring the
   existing two-tool adapter scope.
8. `brg dashboard` — local web view over the same data.
9. `brg export` — Markdown/HTML renderer over the same data; can ship as
   soon as step 1's data model exists, doesn't strictly depend on steps 2-8,
   but sequenced last since it's the lowest-urgency surface.

## Open decisions

- Exact confidence/provenance model for facts extracted vs. facts manually
  stated — still not designed. Now more concrete: facts can arrive via
  the reliable path's live model call (`ai-assisted` tier 1) or the
  opportunistic path (`context_commit`'s `facts`, from an agent's own
  live understanding) — `Fact.confidence` is currently always `'stated'`
  regardless of which one produced it (see `applyFactsDelta`'s default).
  Whether these two provenances should carry different confidence values
  is exactly this open decision, now with real cases to design against.
- Branch garbage collection / pruning strategy for long-lived projects —
  explicitly unsolved in both reference papers too.
- Whether merge conflict resolution UX lives in the CLI, the dashboard, or
  both from day one.

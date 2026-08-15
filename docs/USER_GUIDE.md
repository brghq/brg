# brg User Guide

This is the deep reference for `brg` — every command, every flag, every
concept, and the workflows you'll actually run day to day. If you just
want to get running in a minute, see the [README](../README.md)
Quickstart instead; come back here when you need the details.

## Table of contents

- [Concepts](#concepts)
  - [Branches](#branches)
  - [Context](#context)
  - [Checkpoints](#checkpoints)
  - [Handoff mode vs. wrapper mode](#handoff-mode-vs-wrapper-mode)
- [Configuration](#configuration)
- [Command reference](#command-reference)
  - [`brg setup`](#brg-setup)
  - [`brg tools list`](#brg-tools-list)
  - [`brg init`](#brg-init)
  - [`brg switch <tool>`](#brg-switch-tool)
  - [`brg checkpoint <message>`](#brg-checkpoint-message)
  - [`brg checkout <name>`](#brg-checkout-name)
  - [`brg log`](#brg-log)
  - [`brg status`](#brg-status)
  - [`brg context show`](#brg-context-show)
  - [`brg diff`](#brg-diff)
  - [`brg merge <source>`](#brg-merge-source)
  - [`brg mcp`](#brg-mcp)
  - [`brg dashboard`](#brg-dashboard)
  - [`brg export`](#brg-export)
  - [`brg --version` / `brg --help`](#brg---version--brg---help)
- [Common workflows](#common-workflows)
  - [Switching mid-project from Claude Code to Codex](#switching-mid-project-from-claude-code-to-codex)
  - [Exploring an angle without polluting your main context](#exploring-an-angle-without-polluting-your-main-context)
  - [Picking up a project after a break](#picking-up-a-project-after-a-break)
  - [Bringing a side branch's findings back in](#bringing-a-side-branchs-findings-back-in)
- [Troubleshooting / FAQ](#troubleshooting--faq)
- [Uninstall / reset](#uninstall--reset)

---

## Concepts

If you've never used a tool like `brg` before, start here. If you're
comfortable with `git`'s mental model, most of this will feel familiar —
`brg` deliberately borrows it, right down to the vocabulary.

### Branches

A **brg branch** is an independent thread of project context — its own
intent, rolling summary, structured facts, and checkpoint history. Every
project has at least one (created automatically by `brg init`), and you
can fork more with `brg checkout <name>` to explore an angle without
touching the branch you're already on.

A brg branch's git branch is **optional** and tracked separately
(`.brg/refs/git-map.json`). You can create a context-only brg branch with
no matching git branch at all — useful for exploring an idea without
forking your actual code — or link one so `brg checkout` also moves
`HEAD` for you. Either way, **the currently active brg branch
(`.brg/refs/active`) is always the source of truth for which context is
"current"** — the git branch you happen to have checked out is metadata
only, and `brg status` will warn you (without acting on it) if the two
drift apart.

### Context

**Context** is the running, human-readable summary of a branch: what's
been done, key decisions, open threads. It lives in that branch's
`.brg/branches/<name>/summary.md`, regenerated fresh from its checkpoint
history every time you checkpoint — so it's always a faithful rollup, not
something that needs manual editing or compaction.

Context is what makes switching AI CLIs painless — when you run
`brg switch claude`, `brg` reads the active branch's `summary.md` and
hands its contents to Claude Code as its starting context, so you don't
have to re-explain what you were doing. Without `brg`, that context lives
only in your last tool's chat history, which the next tool can't see.

### Checkpoints

A **checkpoint** is a snapshot of where a branch stands right now — the
same way `git commit` snapshots your repo at a point in time. Running
`brg checkpoint "message"` records an immutable, content-addressed
checkpoint object under `.brg/objects/`, appends its id to the active
branch's `log.jsonl`, and regenerates that branch's `summary.md` to
include it. Alongside your message, a checkpoint also carries:

- **Generated context text** — produced via a tiered fallback (the active
  tool's own session summary, falling back to its raw transcript, falling
  back to a plain formatted line — see [Configuration](#configuration)).
- **Structured facts**, when the active tool or an MCP-connected agent
  can supply them, merged into the branch's `facts.json` — this is what
  `brg diff`/`brg merge` compare.
- **Git reference metadata** (`files_touched`, `git_commit_at_checkpoint`)
  — informational only, never used to decide which branch is active.

You can write a checkpoint explicitly whenever you've reached a point
worth remembering. `brg switch <tool>` also writes one automatically
before it hands off, so you don't lose anything even if you switch
without remembering to checkpoint first.

### Handoff mode vs. wrapper mode

`brg` currently runs in **handoff mode**, the only mode that exists
today: `brg switch <tool>` auto-checkpoints against whatever tool you
were last using, reads the active branch's context, spawns the target AI
CLI as a child process with full terminal control, and then **`brg`
itself exits**. From that point on you're talking directly to `claude`
(or `codex`) with no `brg` process in between. This is why `brg switch`
never returns control to you the way a normal subcommand does — it hands
the terminal over and steps aside.

Because `brg` isn't running during your session, it can't watch what
happens live — but it doesn't need to. Claude Code and Codex both write
their own session transcripts to disk continuously as you work, so `brg`
can reconstruct what happened after the fact just by reading that file,
even if the previous session ended abruptly (a quota limit, a crash).
That's what the auto-checkpoint on `brg switch` does: before handing off,
it tries to summarize the session you're leaving via that tool's own
`--continue`/`resume` (richest, but needs that tool's own auth/quota); if
that's unavailable — for example because the reason you're switching *is*
that the tool just hit its quota — it falls back to reading the raw
transcript file directly (pure local disk access, no auth or quota
needed); if even that isn't available, it falls back to a plain manual
line. See [`contextStrategy`](#configuration) below.

**Wrapper mode** — `brg` staying resident and observing a session live,
instead of reconstructing after the fact — remains a later-phase idea
(see [ROADMAP.md](../ROADMAP.md)), but is no longer expected to be
*required* for context capture, since the fallback chain above already
covers the case it was meant to solve. Handoff mode will remain available
regardless if it ships.

## Configuration

Project-level settings live in `.brg/config.yaml`, created by `brg init`
with this default content:

```yaml
contextStrategy: ai-assisted
```

It's a plain YAML file — edit it directly with any text editor. There is
no `brg config` command yet (planned, see [ROADMAP.md](../ROADMAP.md)).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `contextStrategy` | string | `ai-assisted` | Which strategy generates a checkpoint's context text and, where possible, its structured facts. `ai-assisted` tries, in order: (1) ask the active tool to summarize its own session via `--continue`/`resume --last`, requesting facts alongside the summary in the same call; (2) if that's unavailable, read that tool's own transcript file directly off disk and extract a raw excerpt (no auth/quota needed — this is what still works even when the tool that just failed is the one you're switching away from); (3) if even that fails, fall back to your own message as-is (identical output to `manual`, with an empty facts delta). `manual` skips straight to step 3 — no shelling out to the tool at all, fully offline, zero dependencies, no facts extraction. Set `contextStrategy: manual` in `config.yaml` if you'd rather never shell out to the tool during a checkpoint. |
| `defaultTool` | string | *(unset)* | The tool `brg checkpoint` attributes a checkpoint to when you don't pass `--tool`, what `brg switch` auto-checkpoints against, and what `brg status` reports as your "active tool". Set automatically by `brg switch`; you can also set it by hand, e.g. `defaultTool: claude`. |

The rest of `.brg/` is data, not configuration — see
[Branches](#branches), [Context](#context), and [Checkpoints](#checkpoints)
above for what's stored under `.brg/branches/<name>/` and `.brg/objects/`.

## Command reference

Run `brg <command> --help` at any time for the same flag summary straight
from the source of truth.

### `brg setup`

Interactive wizard that installs and authenticates the AI CLIs you want
to use. Prompts you once for a comma-separated list of tool names (or
`all`), then for each one:

1. **Detects** whether it's already installed (checks if the binary
   resolves on `PATH`). If so, skips installing it.
2. **Installs** it if missing (each tool has its own install command —
   see the adapter table below).
3. **Detects** whether it's already authenticated (checks for that
   tool's own credentials file on disk). If so, skips login.
4. **Triggers login** if missing, by shelling out to that tool's own
   auth flow (e.g. `claude login`).

This makes `brg setup` **idempotent** — running it again only acts on
whatever's still missing. `brg` never handles credentials itself.

**Flags:** none beyond `-h, --help`.

**Example** (selecting only `claude`, which was already set up):

```console
$ brg setup
brg setup — pick which AI CLIs to set up.

  claude     Claude Code
  codex      Codex

Which tools do you want set up? (comma-separated names, or "all") claude

Claude Code
  ✓ already installed
  ✓ already authenticated

✓ Setup complete. Run "brg init" inside a project to get started.
```

Per-tool install/login commands, for reference:

| Tool | Install command | Login command | Credential file(s) checked |
|---|---|---|---|
| `claude` (Claude Code) | `npm install -g @anthropic-ai/claude-code` | `claude login` | `~/.claude/credentials.json`, `~/.claude.json` |
| `codex` (Codex) | `npm install -g @openai/codex` | `codex login` | `~/.codex/auth.json`, `~/.config/codex/auth.json` |

Only these two ship today. Adding another AI CLI is a single new file
implementing the `ToolAdapter` interface in `src/tools/` — see
[CONTRIBUTING.md](../CONTRIBUTING.md) if you want to add one (Gemini CLI
and OpenCode are natural community contributions using the same pattern).

### `brg tools list`

Lists every registered tool adapter and its current state: not
installed, installed-but-not-authenticated, or installed-and-
authenticated. Read-only — makes no changes.

**Flags:** none beyond `-h, --help`.

**Example:**

```console
$ brg tools list
claude     Claude Code    installed, authenticated
codex      Codex          not installed
```

### `brg init`

Creates a `.brg/` directory in the current working directory
(`config.yaml`, `objects/`, `branches/`, `refs/`) and activates a default
branch — named after the checked-out git branch if you're in a git repo
(and linked to it automatically), or `main` otherwise. Also installs an
idempotent `post-checkout` git hook that flags plain `git checkout` usage
landing on a branch brg has no context for yet.

**Idempotent** — if `.brg/` already exists, it does nothing new except
backfill the hook/default branch for a project initialized before those
existed, rather than overwriting anything.

**Flags:** none beyond `-h, --help`.

**Example (first run):**

```console
$ brg init
✓ Initialized .brg/ in /path/to/your-project
```

**Example (already initialized):**

```console
$ brg init
brg is already initialized here — nothing to do.
```

### `brg switch <tool>`

Unless `--fresh` is passed, first auto-checkpoints against whichever tool
`config.yaml`'s `defaultTool` points at (see
[Handoff mode vs. wrapper mode](#handoff-mode-vs-wrapper-mode)) — a
failure here is logged and never blocks the switch. Then reads the active
branch's `summary.md` and hands off full terminal control to `<tool>` in
handoff mode — `brg` exits once the target tool starts. `<tool>` must be
one of the names from `brg tools list` (`claude`, `codex`), and must
already be installed (run `brg setup` first if not).

**Flags:**

| Flag | Default if omitted | Meaning |
|---|---|---|
| `-f, --fresh` | off | Skip the auto-checkpoint and reading context entirely, and start the target tool with a completely clean/empty session — use this when you deliberately don't want prior context carried over. |

**Errors you might see:**

```console
$ brg switch nosuchtool
brg: unknown tool "nosuchtool". Known tools: claude, codex
```

```console
$ brg switch codex
brg: Codex is not installed. Run "brg setup" first.
```

**Example (successful handoff):** once launched, `brg` disappears from
the terminal and you're talking directly to the target tool — there's no
further `brg`-side output to show, since control has fully passed over.

### `brg checkpoint <message>`

Records a checkpoint on the active branch: an immutable object under
`.brg/objects/`, an appended `log.jsonl` entry, and a regenerated
`summary.md`. Requires `.brg/` to exist and an active branch to be set
(both true from the moment you run `brg init`).

**Flags:**

| Flag | Default if omitted | Meaning |
|---|---|---|
| `--tool <name>` | `defaultTool` from `config.yaml`, or the literal string `"unknown"` if that's also unset | Which tool this checkpoint is attributed to. Doesn't have to be a registered adapter name — any label works, but using a real tool name keeps `brg log`/`brg status` output meaningful. |

**Example:**

```console
$ brg checkpoint "wired up the auth middleware" --tool claude
✓ Checkpoint saved.
```

With the default `ai-assisted` strategy and Claude Code available, this
tries `claude -p ... --continue` first, requesting a summary and any new
structured facts in the same call, and merges both into the branch. If
that's unavailable, it falls back to a raw excerpt from Claude Code's own
transcript file (facts empty). If neither is available, it falls back to
your message as-is (the same output `contextStrategy: manual` always
produces).

**Errors you might see:**

```console
$ brg checkpoint "test"
brg: this project hasn't been initialized yet. Run "brg init" first.
```

```console
$ brg checkpoint "test"
brg: no active branch — run "brg checkout" first.
```

### `brg checkout <name>`

The single command for both creating and switching brg context branches
— there's no separate `brg branch`. If `<name>` doesn't exist yet, it's
created and activated; if it already exists, `brg checkout` just switches
to it — **never an error**, even if you "checkout" a branch you're
already effectively working from.

**Creating a new branch:**

1. Asks for an **intent** (what this branch is for) unless `--intent` was
   passed.
2. Decides whether the new branch **inherits** the active branch's facts
   or starts **orphan** (empty) — via `--inherit`/`--orphan`, or an
   interactive prompt if neither flag is given.
3. Decides whether to also create/link a **git branch** — via
   `--git`/`--no-git`/`--git=<name>`, or an interactive prompt if none of
   those are given (skipped automatically outside a git repo). Declining,
   or being outside a git repo, never blocks the brg-side branch — git
   involvement is additive, never required.

**Switching to an existing branch** restores its context (intent,
summary, recent checkpoints) and runs `git checkout` only if that brg
branch has a linked git branch — a context-only branch switches in
place, leaving whatever git branch you're currently on untouched.

**Flags:**

| Flag | Meaning |
|---|---|
| `--intent <text>` | Restated goal for a new branch (prompted if omitted; ignored when switching to an existing branch). |
| `--inherit` | New branch starts with the active branch's current facts. |
| `--orphan` | New branch starts with no inherited facts. |
| `--git [name]` | Also create/link a git branch — same name as the brg branch by default, or a custom one. |
| `--no-git` | Don't create/link a git branch (skips the prompt). |

**Example (creating a new context-only branch to explore an angle):**

```console
$ brg checkout explore-caching --intent "try a Redis-backed cache layer" --orphan --no-git
✓ Created branch "explore-caching"
```

**Example (switching back):**

```console
$ brg checkout main
✓ Switched to "main"

Intent: Default branch, created automatically by "brg init".

Recent checkpoints:
  2026-08-15T09:12:03.441Z claude: wired up the auth middleware
```

### `brg log`

Prints checkpoints as a one-line timeline. Requires `.brg/` to exist.

| Flags (combinable) | Behavior |
|---|---|
| *(none)* | The active branch's checkpoints, newest first. |
| `--all` | Every branch's checkpoints together, flat and tagged by branch name. |
| `--graph` | A lane-based ASCII graph of checkpoint objects for the active branch, in the style of `git log --graph`. |
| `--graph --all` | The same graph across every branch. |

**Example:**

```console
$ brg log
2026-08-15T09:12:03.441Z  claude  wired up the auth middleware
2026-08-15T08:40:11.902Z  codex   moved to codex for the refactor
```

**With no checkpoints yet:**

```console
$ brg log
No checkpoints yet. Run "brg checkpoint <message>" to create one.
```

### `brg status`

A quick snapshot of where the project stands: the active brg branch, the
actual checked-out git branch (with a warning if the two have drifted
apart — see [Branches](#branches)), the configured `defaultTool`, how
long ago the last checkpoint was taken, the active branch's `summary.md`
size, and how many checkpoints were made today (by calendar date, in your
local timezone).

**Flags:** none beyond `-h, --help`.

**Example:**

```console
$ brg status
active branch:     main
git branch:        main
active tool:       claude
last checkpoint:   just now
summary size:      220 bytes
checkpoints today: 2
```

**On an uninitialized directory** (does not error — this is deliberate,
so you can run `brg status` anywhere to check whether you're in a `brg`
project at all):

```console
$ brg status
Not a brg project. Run "brg init" to get started.
```

### `brg context show`

Prints the active branch's `summary.md` to stdout — useful for piping
into another command, or just reading without opening an editor.
Requires `.brg/` to exist and an active branch to be set.

**Flags:** none beyond `-h, --help`.

**Example:**

```console
$ brg context show
- [2026-08-15T08:40:11.902Z] codex: moved to codex for the refactor
- [2026-08-15T09:12:03.441Z] claude: wired up the auth middleware
```

### `brg diff`

Pure structural diff between two branches' fact sets (added/removed/
changed `(subject, relation, object)` triples) — no LLM calls.

| Usage | Compares |
|---|---|
| `brg diff <name>` | The active branch against `<name>`. |
| `brg diff <a> <b>` | `<a>` against `<b>` directly. |

**Example:**

```console
$ brg diff feature-payments
main → feature-payments
  + payment_provider: stripe
  ~ auth_method: session → session, oauth
```

### `brg merge <source>`

Merges `<source>`'s brg context into the currently **active** brg
branch — context-only, no `git merge` involved (run that yourself if
you're also merging code). Facts present in only one branch, or identical
in both, merge automatically; a real conflict (same subject+relation,
different object on each side) is shown as a prompt by default, or
resolved by the active tool as an LLM arbiter first with `--auto`
(falling back to the interactive prompt if the arbiter can't resolve it).
Writes a two-parent merge checkpoint on success.

**Flags:**

| Flag | Meaning |
|---|---|
| `--auto` | Try the active tool as an LLM arbiter before asking interactively. |

**Example (with a conflict):**

```console
$ brg merge feature-payments

Conflict: auth_method uses
  target: session
  source: oauth
Keep [t]arget, [s]ource, or [b]oth? b
✓ Merged "feature-payments" into "main" (sha256:...)
1 conflict(s) resolved.
```

### `brg mcp`

Starts brg's MCP server over stdio, for AI CLIs that support the Model
Context Protocol. Exposes four tools:

| Tool | What it does |
|---|---|
| `context_search` | A branch's intent, summary, facts, and recent checkpoints. Defaults to the active branch. |
| `context_commit` | Records a checkpoint on the active branch — always the active one, with no way to target a different branch, so a connected agent can't silently write context elsewhere. Accepts an optional `facts` array for the agent to push structured facts it already knows, in the same call. |
| `context_diff` | Structural diff between two branches' facts, same engine as `brg diff`. Defaults to the active branch as one side. |
| `context_merge` | Attempts a merge into the target (defaults to active). Conflict-free facts merge and commit immediately; a real conflict is returned as data instead of committed, since there's no way to prompt interactively over MCP — call again with `resolutions` filled in to finish. |

See [`.mcp.json`](../plugin/.mcp.json) for how the bundled Claude Code
plugin registers this server automatically.

### `brg dashboard`

Starts a local web dashboard over `.brg/` — a branch graph (SVG,
branches as horizontal lanes) plus a click-to-inspect checkpoint panel.
Every request reads `.brg/` fresh; no caching or database.

**Flags:**

| Flag | Default | Meaning |
|---|---|---|
| `--port <n>` | `4848` | Port to listen on. |

```console
$ brg dashboard
Dashboard running at http://localhost:4848
```

### `brg export`

Writes a free, local, no-account snapshot of a branch's context to a
file — intent, chronological decision log, and a facts table. Useful for
handing a teammate the state of a branch without giving them `brg`
itself.

**Flags:**

| Flag | Default | Meaning |
|---|---|---|
| `--branch <name>` | the active branch | Branch to export. |
| `--format <md\|html>` | `md` | Output format. HTML is self-contained and additionally embeds the branch graph as inline SVG. |
| `--out <path>` | `brg-export-<branch>.<format>` | Output file path. |

```console
$ brg export --format html
✓ Exported "main" to brg-export-main.html
```

There's no bundled PDF renderer — use your browser's own print-to-PDF on
the HTML export if you need a PDF.

### `brg --version` / `brg --help`

`brg --version` prints the installed version (matches the `brg-cli`
version on npm, since the bin command is `brg` regardless of package
name). `brg --help` prints the full command list; `brg <command> --help`
prints flags for that command specifically.

## Common workflows

### Switching mid-project from Claude Code to Codex

You've been working in Claude Code, made progress, and want to hand the
same project off to Codex without re-explaining anything.

```bash
# Just switch — brg auto-checkpoints against Claude Code first, then
# reads the active branch's summary and hands it to codex, then exits
brg switch codex
```

You don't have to checkpoint manually first — `brg switch` does it for
you, trying Claude Code's own session summary and falling back to its
raw transcript if that's unavailable (e.g. Claude Code just hit a quota
limit, which is exactly the moment you're likely to be switching away
from it). Codex starts with the resulting summary as its initial context.
A manual checkpoint is still worth writing at any point you want a
specific message recorded rather than an auto-generated one:

```bash
brg checkpoint "frontend wired up, tests still failing on auth" --tool codex
brg switch claude
```

### Exploring an angle without polluting your main context

You want to try a different approach without it becoming part of your
main branch's context trail, and without necessarily forking your git
history either.

```bash
brg checkout explore-caching --orphan --no-git
# ...work, checkpoint as you go...
brg checkout main   # back to where you were, main's context untouched
```

A context-only brg branch (no `--git`) never touches `HEAD` — you can
switch between brg branches freely while staying on the same git branch
throughout, or link a git branch too with `--git` if you also want the
code isolated.

### Picking up a project after a break

You're back on a project after a few days away and don't remember
exactly where you left off.

```bash
brg status         # active branch, when the last checkpoint was, how big its summary is
brg log             # skim recent checkpoint messages for the active branch
brg context show    # read the full rolling summary
brg switch claude    # resume with that context loaded
```

### Bringing a side branch's findings back in

You explored something on a side branch and want its facts folded back
into the branch you started from.

```bash
brg checkout main               # make sure "main" is active — merge always targets the active branch
brg merge explore-caching       # union facts automatically, prompts on real conflicts
```

## Troubleshooting / FAQ

**`brg: this project hasn't been initialized yet. Run "brg init" first.`**
You ran a command that needs `.brg/` outside an initialized project. Run
`brg init` in that directory first. `brg status` is the one exception —
it reports "Not a brg project" instead of erroring, so it's always safe
to run.

**`brg: no active branch — run "brg checkout" first.`**
`.brg/` exists but there's no active branch pointer — this shouldn't
normally happen since `brg init` always seeds one, but can if you've
manually edited `.brg/refs/active`. Run `brg checkout <name>` to set one.

**`brg: unknown tool "<name>". Known tools: claude, codex`**
You passed a tool name to `brg switch` that isn't one of the two
registered adapters. Check spelling — it's the short name (`claude`, not
`Claude Code`).

**`brg: <Tool> is not installed. Run "brg setup" first.`**
`brg switch` requires the target tool's binary to already be on `PATH`.
Run `brg setup` and select that tool, or install it manually with the
command from the [`brg setup` table](#brg-setup) above.

**`brg setup` says a tool is "not authenticated" even though I know I logged in**
Detection works by checking for that tool's credentials file at one of a
couple of fixed paths (see the table under [`brg setup`](#brg-setup)). If
that tool has changed where it stores credentials since this version of
`brg` was published, detection can go stale — check the relevant
`src/tools/<name>.ts` adapter in the repo, or open an issue.

**`brg checkpoint` seems slow, or I don't want it shelling out to my AI CLI**
That's the `ai-assisted` strategy's tier 1 (`--continue`/`resume --last`)
running — it can take a few seconds since it's a real call to the tool.
Set `contextStrategy: manual` in `.brg/config.yaml` if you'd rather
checkpoints stay instant and fully offline, at the cost of losing the
richer auto-generated summaries and structured facts.

**`brg status` warns about my git branch — is that a problem?**
No — it's informational only. It means the git branch you have checked
out doesn't match (or has no) linked git branch for your active brg
branch. Nothing in `brg` acts on this automatically; it's just a
heads-up in case it's not what you expected.

**`npm install -g brg-cli` says the command isn't found afterward**
Make sure npm's global bin directory is on your `PATH`. Run `npm config
get prefix` to find it, then confirm `<prefix>/bin` (or `<prefix>` on
Windows) is in your shell's `PATH`.

**Why is the npm package called `brg-cli` but the command is `brg`?**
npm's registry blocks the bare name `brg` as too similar to existing
package names. The package had to be published as `brg-cli`; the `bin`
field inside it still maps to the `brg` command, so nothing about actual
usage changes.

**My AI CLI's own login/auth is failing**
`brg` doesn't handle authentication itself — `brg setup`/`brg switch`
shell out directly to each tool's own login flow (`claude login`,
`codex login`). If login itself is failing, that's an issue with the
underlying tool's CLI or your account, not with `brg` — check that
tool's own documentation.

## Uninstall / reset

**Remove `brg` itself (global install):**

```bash
npm uninstall -g brg-cli
```

**Remove a single project's `brg` data** (branches, checkpoints, config —
irreversible, this is real project history):

```bash
rm -rf .brg/
```

Run this from inside the project directory. There's no separate command
for it yet — `.brg/` is a plain directory, so removing it is the same as
deleting any other folder.

**Full reset**: run both of the above. This does not touch any AI CLI
`brg` launched (Claude Code, Codex) — those are separate tools with their
own install/uninstall/credentials, unaffected by removing `brg`.

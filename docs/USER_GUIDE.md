# brg User Guide

This is the deep reference for `brg` — every command, every flag, every
concept, and the workflows you'll actually run day to day. If you just
want to get running in a minute, see the [README](../README.md)
Quickstart instead; come back here when you need the details.

## Table of contents

- [Concepts](#concepts)
  - [Context](#context)
  - [Checkpoints](#checkpoints)
  - [Sessions](#sessions)
  - [Handoff mode vs. wrapper mode](#handoff-mode-vs-wrapper-mode)
- [Configuration](#configuration)
- [Command reference](#command-reference)
  - [`brg setup`](#brg-setup)
  - [`brg tools list`](#brg-tools-list)
  - [`brg init`](#brg-init)
  - [`brg switch <tool>`](#brg-switch-tool)
  - [`brg checkpoint <message>`](#brg-checkpoint-message)
  - [`brg log`](#brg-log)
  - [`brg status`](#brg-status)
  - [`brg context show`](#brg-context-show)
  - [`brg --version` / `brg --help`](#brg---version--brg---help)
- [Common workflows](#common-workflows)
  - [Switching mid-project from Claude Code to Codex](#switching-mid-project-from-claude-code-to-codex)
  - [Starting a throwaway experiment without polluting context](#starting-a-throwaway-experiment-without-polluting-context)
  - [Picking up a project after a break](#picking-up-a-project-after-a-break)
- [Troubleshooting / FAQ](#troubleshooting--faq)
- [Uninstall / reset](#uninstall--reset)

---

## Concepts

If you've never used a tool like `brg` before, start here. If you're
comfortable with `git`'s mental model, most of this will feel familiar —
`brg` deliberately borrows it.

### Context

**Context** is the running, human-readable summary of your project:
what's been done, key decisions, open threads. It lives in one plain
Markdown file, `.brg/context.md`, inside your project.

Context is what makes switching AI CLIs painless — when you run
`brg switch claude`, `brg` reads `context.md` and hands its contents to
Claude Code as its starting context, so you don't have to re-explain what
you were doing. Without `brg`, that context lives only in your last
tool's chat history, which the next tool can't see.

### Checkpoints

A **checkpoint** is a snapshot of where the project stands right now —
the same way `git commit` snapshots your repo at a point in time.
Running `brg checkpoint "message"`:

1. Appends a line to `.brg/context.md` describing what happened.
2. Writes a structured record to `.brg/sessions/<timestamp>.json`.

You can write one explicitly whenever you've reached a point worth
remembering. `brg switch <tool>` also writes one automatically before it
hands off — see [Handoff mode vs. wrapper mode](#handoff-mode-vs-wrapper-mode)
— so you don't lose anything even if you switch without remembering to
checkpoint first.

### Sessions

A **session** is the structured, on-disk record of a single checkpoint:
one JSON file per checkpoint under `.brg/sessions/`, named after its
timestamp. Each file has the shape:

```json
{
  "timestamp": "2026-08-10T11:53:41.187Z",
  "tool": "claude",
  "message": "first pass on the parser",
  "contextSnapshot": "- [2026-08-10T11:53:41.179Z] claude: first pass on the parser"
}
```

`brg log` reads every session file and prints them as a timeline.
`context.md` is the human-readable rollup of the same information;
`sessions/` is the structured, per-checkpoint record behind it.

### Handoff mode vs. wrapper mode

`brg` currently runs in **handoff mode**, the only mode that exists
today: `brg switch <tool>` auto-checkpoints against whatever tool you
were last using (see below), reads your context, spawns the target AI
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
`--continue`/`resume` (richest, but needs that tool's own auth/quota);
if that's unavailable — for example because the reason you're switching
*is* that the tool just hit its quota — it falls back to reading the raw
transcript file directly (pure local disk access, no auth or quota
needed); if even that isn't available, it falls back to a plain manual
line. See [`contextStrategy`](#configuration) below.

**Wrapper mode** — `brg` staying resident and observing a session live,
instead of reconstructing after the fact — remains a Phase 2 idea (see
[ROADMAP.md](../ROADMAP.md)), but is no longer expected to be *required*
for context capture, since the fallback chain above already covers the
case it was meant to solve. It does not exist yet in `0.1.0`; handoff
mode will remain available regardless if it ships.

## Configuration

Project-level settings live in `.brg/config.yaml`, created by `brg init`
with this default content:

```yaml
contextStrategy: ai-assisted
```

It's a plain YAML file — edit it directly with any text editor. There is
no `brg config` command yet (planned for Phase 3).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `contextStrategy` | string | `ai-assisted` | Which strategy generates the checkpoint line appended to `context.md`. `ai-assisted` tries, in order: (1) ask the active tool to summarize its own session via `--continue`/`resume --last`; (2) if that's unavailable, read that tool's own transcript file directly off disk and extract a raw excerpt (no auth/quota needed — this is what still works even when the tool that just failed is the one you're switching away from); (3) if even that fails, fall back to your own message as-is (identical output to `manual`). `manual` skips straight to step 3 — no shelling out to the tool at all, fully offline, zero dependencies. Set `contextStrategy: manual` in `config.yaml` if you'd rather never shell out to the tool during a checkpoint. |
| `defaultTool` | string | *(unset)* | The tool `brg checkpoint` attributes a checkpoint to when you don't pass `--tool`, and what `brg status` reports as your "active tool". Not currently set by any command — add it to `config.yaml` by hand, e.g. `defaultTool: claude`. |

The rest of `.brg/` is data, not configuration — see
[Sessions](#sessions) and [Context](#context) above for what's stored in
`context.md` and `sessions/`.

## Command reference

Every command below was run against the real, built CLI to produce the
example output shown. Run `brg <command> --help` at any time for the
same flag summary straight from the source of truth.

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

Only these two ship in `0.1.0`. Adding another AI CLI is a single new file
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

Creates a `.brg/` directory in the current working directory:
`context.md` (with a starter header), `config.yaml` (with the default
`contextStrategy: ai-assisted`), and an empty `sessions/` directory.

**Idempotent** — if `.brg/` already exists, it does nothing and tells
you so, rather than overwriting your context or config.

**Flags:** none beyond `-h, --help`.

**Example (first run):**

```console
$ brg init
✓ Initialized .brg/ in /path/to/your-project
```

**Example (already initialized):**

```console
$ brg init
.brg/ already exists — nothing to do.
```

### `brg switch <tool>`

Unless `--fresh` is passed, first auto-checkpoints against whichever tool
your last session record belongs to (see
[Handoff mode vs. wrapper mode](#handoff-mode-vs-wrapper-mode)) — a
failure here is logged and never blocks the switch. Then reads
`.brg/context.md` and hands off full terminal control to `<tool>` in
handoff mode — `brg` exits once the target tool starts. `<tool>` must be
one of the names from `brg tools list` (`claude`, `codex`), and must
already be installed (run `brg setup` first if not).

**Flags:**

| Flag | Default if omitted | Meaning |
|---|---|---|
| `-f, --fresh` | off | Skip the auto-checkpoint and reading `context.md` entirely, and start the target tool with a completely clean/empty session — use this when you deliberately don't want prior context carried over. |

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

Snapshots the current project state: appends a line to `.brg/context.md`
and writes a new file under `.brg/sessions/`. Requires `.brg/` to exist
(`brg init` first).

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
tries `claude -p ... --continue` first and appends its summary. If that's
unavailable, it falls back to a raw excerpt from Claude Code's own
transcript file. If neither is available, it falls back to a line like
the one below — the same output `contextStrategy: manual` always
produces, enriched with the current git branch and diffstat for free
when the project is a git repo (see [Configuration](#configuration)):

```
- [2026-08-10T11:53:41.179Z] claude: wired up the auth middleware (main, 3 files changed, 42 insertions(+), 5 deletions(-))
```

**Error if `.brg/` doesn't exist:**

```console
$ brg checkpoint "test"
brg: no .brg/ directory found. Run "brg init" first.
```

### `brg log`

Prints every checkpoint as a one-line timeline, most recent first.
Requires `.brg/` to exist.

**Flags:** none beyond `-h, --help`.

**Example:**

```console
$ brg log
2026-08-10T11:53:42.315Z  codex  moved to codex for the refactor
2026-08-10T11:53:41.187Z  unknown  first pass on the parser
```

**With no checkpoints yet:**

```console
$ brg log
No checkpoints yet. Run "brg checkpoint <message>" to create one.
```

### `brg status`

A quick snapshot of where the project stands: the configured
`defaultTool`, how long ago the last checkpoint was taken, the current
size of `context.md`, and how many checkpoints were made today (by
calendar date, in your local timezone).

**Flags:** none beyond `-h, --help`.

**Example:**

```console
$ brg status
active tool:       (not set)
last checkpoint:   just now
context.md size:   220 bytes
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

Prints the raw contents of `.brg/context.md` to stdout — useful for
piping into another command, or just reading without opening an editor.
Requires `.brg/` to exist.

**Flags:** none beyond `-h, --help`.

**Example:**

```console
$ brg context show
# Project Context

Rolling summary — what's been done, key decisions, open threads.

- [2026-08-10T11:53:41.179Z] claude: first pass on the parser
- [2026-08-10T11:53:42.315Z] codex: moved to codex for the refactor
```

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
# reads context.md and hands it to codex, then exits
brg switch codex
```

You don't have to checkpoint manually first — `brg switch` does it for
you, trying Claude Code's own session summary and falling back to its
raw transcript if that's unavailable (e.g. Claude Code just hit a quota
limit, which is exactly the moment you're likely to be switching away
from it). Codex starts with the resulting `context.md` as its initial
context. A manual checkpoint is still worth writing at any point you
want a specific message recorded rather than an auto-generated one:

```bash
brg checkpoint "frontend wired up, tests still failing on auth" --tool codex
brg switch claude
```

### Starting a throwaway experiment without polluting context

You want to try something risky in a tool without it becoming part of
your project's permanent context trail.

```bash
brg switch codex --fresh
```

`--fresh` skips reading `context.md` entirely, so Codex starts with a
blank slate. Nothing about this session gets written back automatically
either — only an explicit `brg checkpoint` would add to `context.md`, so
an experiment you abandon without checkpointing leaves no trace.

### Picking up a project after a break

You're back on a project after a few days away and don't remember
exactly where you left off.

```bash
brg status         # when was the last checkpoint, how big is context.md
brg log             # skim recent checkpoint messages for the full timeline
brg context show    # read the full rolling summary
brg switch claude    # resume with that context loaded
```

## Troubleshooting / FAQ

**`brg: no .brg/ directory found. Run "brg init" first.`**
You ran a command that needs `.brg/` (`checkpoint`, `log`, `context
show`) outside an initialized project. Run `brg init` in that directory
first. `brg status` is the one exception — it reports "Not a brg
project" instead of erroring, so it's always safe to run.

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
richer auto-generated summaries.

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

**Remove a single project's `brg` data** (context, checkpoints, config —
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

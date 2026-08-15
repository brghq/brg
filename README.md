<p align="center">
  <img src="assets/logo.png" width="120" alt="brg logo">
</p>

<h1 align="center">brg</h1>

<p align="center"><b>Never explain yourself twice.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/brg-cli"><img src="https://img.shields.io/npm/v/brg-cli.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/brg-cli"><img src="https://img.shields.io/npm/dm/brg-cli.svg" alt="npm downloads"></a>
  <a href="https://github.com/brghq/brg/actions/workflows/ci.yml"><img src="https://github.com/brghq/brg/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/brg-cli.svg" alt="MIT license"></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-C9762F.svg" alt="PRs welcome"></a>
</p>

`brg` is a git-style CLI orchestrator that switches you between AI coding
CLIs — Claude Code and Codex today — without losing the context of what
you were doing.

## Why brg

Every multi-tool AI workflow runs into the same problem: you re-explain
the project, the decisions, the open threads, every time you switch
tools. `brg` carries that context with you instead, the way `git`
carries your repo's history instead of making you retype it.

## Demo

Real output from the CLI — `brg init` → `brg checkpoint` → `brg log` →
`brg status` in a fresh project:

```console
$ brg tools list
claude     Claude Code    installed, authenticated
codex      Codex          not installed

$ brg init
✓ Initialized .brg/ in /path/to/your-project

$ brg checkpoint "wired up the auth middleware" --tool claude
✓ Checkpoint saved.

$ brg log
2026-08-10T11:26:57.784Z  claude  wired up the auth middleware

$ brg status
active branch:     main
active tool:       (not set)
last checkpoint:   just now
summary size:      153 bytes
checkpoints today: 1
```

## Installation

```bash
npm install -g brg-cli
```

Requires **Node.js 18+**. The npm package is named `brg-cli` — npm's
registry blocks the bare name `brg` as too similar to existing packages —
but the command it installs is just `brg`.

## Quickstart

```bash
brg setup           # install/authenticate the AI CLIs you want to use
brg init             # create a .brg/ directory in your project
brg switch claude    # hand off to Claude Code with your project context loaded
```

- `brg setup` walks you through installing and logging into each AI CLI —
  idempotent, so re-running it skips anything already set up.
- `brg init` creates `.brg/` in the current directory and activates a
  default branch (see "How it works" below).
- `brg switch claude` reads the active branch's rolling summary, hands
  off full terminal control to `claude` with that context loaded, then
  exits.

For the full command reference and detailed guides — every flag, how
context/checkpoints/sessions work, common workflows, troubleshooting, and
uninstall instructions — see [docs/USER_GUIDE.md](./docs/USER_GUIDE.md).

## Command reference

| Command | Description | Example |
|---|---|---|
| `brg setup` | Interactive wizard to install/authenticate supported AI CLIs | `brg setup` |
| `brg tools list` | List which AI CLIs are registered, installed, and authenticated | `brg tools list` |
| `brg init` | Create a `.brg/` directory in the current project | `brg init` |
| `brg switch <tool>` | Hand off to an AI CLI, carrying project context with you | `brg switch claude` |
| `brg switch <tool> -f, --fresh` | Same, but skip context — start a completely clean session | `brg switch codex --fresh` |
| `brg checkpoint <message>` | Snapshot current state with a message, like `git commit` | `brg checkpoint "fixed the auth bug" --tool claude` |
| `brg checkpoint <message> --tool <name>` | Attribute the checkpoint to a specific tool | `brg checkpoint "..." --tool codex` |
| `brg log` | Print a timeline of checkpoints, most recent first | `brg log` |
| `brg log --graph` | Render the branch/checkpoint graph | `brg log --graph` |
| `brg status` | Show active branch/tool, last checkpoint, summary size, today's checkpoint count | `brg status` |
| `brg context show` | Print the active branch's rolling summary to stdout | `brg context show` |
| `brg branch <name>` | Create a brg context branch, optionally linked to a new git branch | `brg branch feature-payments` |
| `brg checkout <name>` | Switch to a brg branch, checking out its linked git branch if it has one | `brg checkout feature-payments` |
| `brg diff <a> <b>` | Show fact differences between two branches | `brg diff main feature-payments` |
| `brg merge <source>` | Merge a branch's context into the currently active branch | `brg merge feature-payments` |
| `brg mcp` | Start brg's MCP server over stdio | `brg mcp` |
| `brg --version` | Print the installed version | `brg --version` |
| `brg --help` | Show all commands | `brg --help` |

Run `brg <command> --help` for any command's exact flags, or see
[docs/USER_GUIDE.md](./docs/USER_GUIDE.md) for a full breakdown of every
flag with examples.

## How it works

`brg` keeps everything in plain, local files — no database, no server.
Context is organized into **branches** — you can fork a separate thread
of context to explore an angle without polluting the one you're already
on, optionally linked to a real git branch, optionally not.

```
.brg/
├── objects/            Immutable, content-addressed checkpoint objects.
├── branches/<name>/
│   ├── intent.md         Restated goal for this branch, set at creation.
│   ├── summary.md         Rolling summary, regenerated on every
│   │                       checkpoint. This is what gets injected on
│   │                       `brg switch` and shown by `brg context show`.
│   └── facts.json         Structured facts (used by `brg diff`/`brg merge`).
├── refs/
│   ├── active           Which branch is currently active.
│   └── git-map.json      Branch -> linked git branch, if any.
└── config.yaml          Project-level settings (default tool, context
                           strategy).
```

A **checkpoint** is a snapshot of where the project stands — a message
you write (git-commit style), recorded on the active branch. It's
generated via a tiered fallback: trying the active tool's own session
summary first, falling back to reading its transcript straight off disk
if that's unavailable (e.g. it just hit a quota limit), and falling back
to a plain message as a last resort. A **switch** first auto-checkpoints
against whatever tool you were last using, then hands the active
branch's freshly regenerated summary to the target tool as its starting
context — so you don't have to re-explain what you were doing, even if
the previous session ended abruptly.

Everything is plain, git-diffable JSON/Markdown — open any branch's
`summary.md` in a text editor and read its history without running `brg`
at all. See [docs/CONTEXT_VERSIONING.md](./docs/CONTEXT_VERSIONING.md)
for the full data model and design.

## Supported AI CLIs

- [Claude Code](https://claude.com/claude-code)
- Codex

Support for more CLIs is community-extensible — adding one means adding a
single adapter file under `src/tools/` that implements the `ToolAdapter`
interface, no changes needed elsewhere in the codebase. Gemini CLI and
OpenCode are natural candidates for a community-contributed adapter. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

A [Claude Code plugin](./plugin/) is also available — `SessionStart`/
`PreCompact` hooks plus `brg mcp` bundled together. Codex has no
equivalent plugin system today.

## Roadmap

Phase 1 (auto-checkpoint on `brg switch`, tiered context summarization)
and the core of Phase 2 (context branching — `brg branch`/`checkout`/
`diff`/`merge`/`log --graph`, an MCP server, and a Claude Code plugin) are
shipped. `brg dashboard`, `brg export`, and structured fact extraction
(so `brg diff`/`brg merge` have real facts to compare, not just an empty
`facts.json`) are planned next, with cloud sync further out. Full detail
in [ROADMAP.md](./ROADMAP.md).

## Contributing

Contributions are welcome — bug reports, feature ideas, docs fixes, and
code all help. See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup,
the PR flow, and code style, and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for how we work together.

## License

[MIT](./LICENSE)

## Author

Created and maintained by [Shivam Shukla](https://github.com/brghq).

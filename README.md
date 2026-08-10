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
CLIs — Claude Code, Gemini CLI, Codex, OpenCode — without losing the
context of what you were doing.

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
gemini     Gemini CLI     not installed
codex      Codex          not installed
opencode   OpenCode       not installed

$ brg init
✓ Initialized .brg/ in /path/to/your-project

$ brg checkpoint "wired up the auth middleware" --tool claude
✓ Checkpoint saved.

$ brg log
2026-08-10T11:26:57.784Z  claude  wired up the auth middleware

$ brg status
active tool:       (not set)
last checkpoint:   just now
context.md size:   153 bytes
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
- `brg init` creates `.brg/` in the current directory: `context.md`,
  `config.yaml`, `sessions/`.
- `brg switch claude` reads `.brg/context.md`, hands off full terminal
  control to `claude` with that context loaded, then exits.

## Command reference

| Command | Description | Example |
|---|---|---|
| `brg setup` | Interactive wizard to install/authenticate supported AI CLIs | `brg setup` |
| `brg tools list` | List which AI CLIs are registered, installed, and authenticated | `brg tools list` |
| `brg init` | Create a `.brg/` directory in the current project | `brg init` |
| `brg switch <tool>` | Hand off to an AI CLI, carrying project context with you | `brg switch claude` |
| `brg switch <tool> -f, --fresh` | Same, but skip context — start a completely clean session | `brg switch gemini --fresh` |
| `brg checkpoint <message>` | Snapshot current state with a message, like `git commit` | `brg checkpoint "fixed the auth bug" --tool claude` |
| `brg checkpoint <message> --tool <name>` | Attribute the checkpoint to a specific tool | `brg checkpoint "..." --tool codex` |
| `brg log` | Print a timeline of checkpoints, most recent first | `brg log` |
| `brg status` | Show active tool, last checkpoint, context size, today's checkpoint count | `brg status` |
| `brg context show` | Print the current `.brg/context.md` to stdout | `brg context show` |
| `brg --version` | Print the installed version | `brg --version` |
| `brg --help` | Show all commands | `brg --help` |

Run `brg <command> --help` for any command's exact flags.

## How it works

`brg` keeps everything in plain, local files — no database, no server.

```
.brg/
├── context.md         Human-readable rolling summary of the project.
│                       This is what gets injected on `brg switch`.
├── config.yaml         Project-level settings (default tool, context
│                        strategy).
└── sessions/
    └── <ISO-timestamp>.json    One file per checkpoint:
                                  { timestamp, tool, message, contextSnapshot }
```

A **checkpoint** is a snapshot of where the project stands — a message
you write (git-commit style) that gets appended to `context.md` and
recorded as its own session file. A **switch** reads the current
`context.md` and hands it to the target tool as its starting context, so
you don't have to re-explain what you were doing.

Everything is git-diffable — open `context.md` in a text editor and read
your project history without running `brg` at all.

## Supported AI CLIs

- [Claude Code](https://claude.com/claude-code)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- Codex
- OpenCode

Support for more CLIs is community-extensible — adding one means adding a
single adapter file under `src/tools/` that implements the `ToolAdapter`
interface, no changes needed elsewhere in the codebase. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Roadmap

Phase 1 (above) is shipped. Context branching (`brg branch`/`checkout`/
`merge`), a diff/doctor toolset, and an opt-in "wrapper mode" for live
auto-checkpointing are planned next, with cloud sync further out. Full
detail in [ROADMAP.md](./ROADMAP.md).

## Contributing

Contributions are welcome — bug reports, feature ideas, docs fixes, and
code all help. See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup,
the PR flow, and code style, and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for how we work together.

## License

[MIT](./LICENSE)

## Author

Created and maintained by [Shivam Shukla](https://github.com/brghq).

# CLAUDE.md

This file gives Claude Code full context on the `brg` project — what it is,
what to build for the MVP, and the standards to follow. Read this fully
before writing any code.

---

## What this project is

`brg` is a git-style CLI orchestrator that lets developers switch between
different AI coding CLIs (Claude Code, Gemini CLI, Codex, OpenCode, etc.)
while carrying project context with them — so you don't have to re-explain
what you were doing every time you switch tools.

Tagline: **"Never explain yourself twice."**

Core idea: `brg switch claude` hands off to Claude Code with the project's
rolling context loaded. `brg switch gemini -f` starts a completely fresh
Gemini session, skipping context. `brg checkpoint "message"` saves a
snapshot of where the project stands, the way `git commit` does.

This repo (`github.com/brghq/brg`) is the **CLI** — free and open-source,
forever. (A future paid layer — cloud sync, team features, a Windows GUI —
is a separate, later effort and is **out of scope** for this MVP. Don't
build toward it yet, just don't paint us into a corner architecturally.)

---

## Tech stack (already decided — do not deviate without discussion)

- **Language/runtime:** TypeScript on Node.js
- **CLI framework:** Commander.js
- **Storage:** Flat files only — Markdown for human-readable context,
  JSON for structured session/checkpoint records. No database for the MVP.
- **Config format:** YAML (via `js-yaml`)
- **Distribution:** npm (`npm install -g brg`)
- **Switching mode:** "Handoff mode" — `brg` spawns the target AI CLI as a
  child process using Node's `child_process` (`spawn`, with
  `stdio: 'inherit'`) and hands off full terminal control to it, then exits.
  `brg` does **not** stay in the loop intercepting stdin/stdout for the MVP
  (that's the future "wrapper mode," out of scope here).
- **Package name / bin command:** both are `brg`. The npm package name and
  the terminal command are the same.

---

## Command surface to build (Phase 1 / MVP only)

Implement exactly these commands for the MVP. Do not add commands beyond
this list without flagging it first — scope creep here slows down shipping.

```
brg setup                 Interactive wizard: asks which AI CLIs the user
                            wants (Claude Code, Gemini CLI, Codex, OpenCode).

                            MUST be idempotent — running it twice must never
                            reinstall or re-trigger login for a tool that's
                            already set up. Concretely, for each tool:
                              1. Detect first (e.g. `which claude` / checking
                                 for the binary on PATH). If found, show it
                                 as "already installed ✓" and skip install.
                              2. Detect login state (e.g. does that tool's
                                 own config/credentials file already exist?).
                                 If already logged in, show "already
                                 authenticated ✓" and skip the login prompt.
                              3. Only install and only trigger login for
                                 tools that are actually missing either step.
                            This detect-then-act pattern belongs in
                            `utils/detect.ts` (see Architecture below) so
                            every tool adapter uses the same logic rather
                            than each reimplementing its own check.

                            brg never handles credentials itself — it only
                            shells out to each tool's own auth flow
                            (`claude login`, etc.).

brg tools list             Lists which AI CLIs are registered/installed.

brg init                   Creates a `.brg/` directory in the current
                            project folder: `.brg/context.md`,
                            `.brg/config.yaml`, `.brg/sessions/`.

brg switch <tool>          Reads `.brg/context.md`, spawns the target tool
                            (e.g. `claude`, `gemini`) with that context
                            injected as an initial system prompt / message,
                            hands off terminal control, then exits.

brg switch <tool> -f       Same as above but skips reading context —
brg switch <tool> --fresh  starts a completely clean session.

brg checkpoint "message"   Snapshots current state to
                            `.brg/sessions/<timestamp>.json` with the
                            given message, and appends a line to
                            `.brg/context.md` via whichever context
                            strategy is active (see "Context generation
                            strategy" under Architecture below — default
                            for the MVP is the manual/log strategy).

brg log                    Prints a timeline of checkpoints (timestamp,
                            tool, message), most recent first.

brg status                 Shows: active tool (if known), time since last
                            checkpoint, size of context.md, session count
                            today.

brg context show           Prints the current `.brg/context.md` to stdout.

brg --version
brg --help
```

Command naming pattern going forward is `brg <verb> <noun>` — keep any new
commands consistent with that.

## Explicitly NOT in scope for this MVP

Do not build these yet — they're documented here only so you don't
accidentally block them architecturally:
- `brg branch` / `brg checkout` / `brg merge` (Phase 2 — context branching)
- `brg diff`, `brg show <checkpoint-id>`, `brg doctor`
- `brg run --all` (parallel multi-tool prompts)
- `brg sync push/pull` (cloud sync — this is part of the future paid tier)
- Any telemetry — if you'd add telemetry, it must be opt-in, anonymous, and
  clearly disclosed; but don't add it in this MVP pass at all.

---

## Architecture — this section matters as much as the command list

This is an open-source project. The #1 design goal, above any individual
feature, is: **adding or changing one thing must not require touching
unrelated files.** A contributor adding support for a new AI CLI, or fixing
how checkpoints are stored, should be able to do it by editing one focused
area of the codebase — not by hunting through command-handler files that
also contain unrelated logic. Follow this structure:

```
src/
├── commands/            One file per CLI command. Each file ONLY parses
│   ├── setup.ts           its own args and calls into core/ or tools/ —
│   ├── init.ts             it contains no business logic itself. E.g.
│   ├── switch.ts           switch.ts asks tools/registry.ts for the
│   ├── checkpoint.ts       right adapter and core/context.ts for the
│   ├── log.ts               current context, then calls adapter.launch().
│   └── status.ts            It does not know HOW context is stored or
│                             HOW a given tool is launched.
│
├── core/                 Business logic, independent of any specific
│   ├── context.ts          command or tool. context.ts does NOT contain
│   ├── session.ts          summarization logic itself — it owns reading/
│   └── config.ts           writing context.md and delegates HOW a
│                            checkpoint's text is produced to whichever
│                            context strategy is active (see below).
│                            session.ts and config.ts own session JSON
│                            files and config.yaml respectively. Nothing
│                            outside core/ touches the filesystem format
│                            directly — commands and tools call these
│                            functions instead of doing their own
│                            fs.readFile/writeFile on .brg/ files.
│
├── context-strategies/   How a checkpoint's text gets produced is its own
│   ├── types.ts            swappable concern — same pattern as tools/.
│   ├── manual.ts            ContextStrategy interface (types.ts):
│   └── ai-assisted.ts         generate(userMessage, tool): Promise<string>
│                            manual.ts (DEFAULT for the MVP): returns the
│                            user's own checkpoint message, formatted as
│                            `- [<timestamp>] <tool>: <message>` — no AI
│                            call, no API key, no extra dependency, fully
│                            offline. This is the only strategy wired up
│                            and active in the MVP.
│                            ai-assisted.ts (STUB ONLY — do not fully
│                            implement in this pass, just leave the file
│                            with the interface implemented as a clear
│                            TODO): the idea for later is that instead of
│                            calling an external API, it asks the user's
│                            *currently active* tool to summarize the
│                            session — e.g. shell out to `claude -p
│                            "summarize this session in one line"` using
│                            whatever CLI the user already has open and
│                            authenticated. No separate API key needed,
│                            since it rides on the tool the user is
│                            already logged into. core/context.ts should
│                            be written against the ContextStrategy
│                            interface so that swapping manual → ai-
│                            assisted later is a one-line change (which
│                            strategy config.yaml points to), not a
│                            rewrite of context.ts or any command file.
│
├── tools/                Every supported AI CLI is a self-contained
│   ├── types.ts            adapter implementing the same interface
│   ├── claude.ts            (ToolAdapter, defined in types.ts). Adding a
│   ├── gemini.ts            new supported tool (e.g. Codex, OpenCode, or
│   ├── codex.ts             a community-contributed one) means adding
│   ├── opencode.ts          exactly ONE new file here that implements
│   └── registry.ts          the interface — no changes needed to
│                             commands/, core/, or any other tool's file.
│                             registry.ts is the only place that knows the
│                             full list of tools; it exports something
│                             like `getAdapter(name: string): ToolAdapter`.
│
└── utils/
    ├── detect.ts           Shared "is this installed / is this logged
    │                        in" detection logic, used by every tool
    │                        adapter's isInstalled()/isLoggedIn() — so
    │                        detection behavior stays consistent instead
    │                        of each adapter reinventing it.
    └── spawn.ts             Shared child-process spawn/handoff logic used
                              by every adapter's launch() method.
```

### The `ToolAdapter` interface (the key abstraction)

Every AI CLI `brg` supports — Claude Code, Gemini CLI, Codex, OpenCode, and
anything a contributor adds later — implements this same shape:

```typescript
// src/tools/types.ts
export interface ToolAdapter {
  name: string;                 // e.g. "claude"
  displayName: string;          // e.g. "Claude Code"
  isInstalled(): boolean;
  install(): Promise<void>;
  isLoggedIn(): boolean;
  login(): Promise<void>;
  launch(contextText?: string): void;  // handoff mode: spawn + inherit stdio
}
```

`commands/switch.ts`, `commands/setup.ts`, etc. only ever talk to this
interface via `registry.ts` — they must never contain tool-specific
branching logic (no `if (tool === 'claude') { ... } else if (tool ===
'gemini') { ... }` inside a command file). That branching is exactly what
the adapter pattern exists to avoid, and it's what keeps this extensible
for outside contributors without them needing to understand the whole
codebase.

### The `ContextStrategy` interface (same pattern, applied to summarization)

```typescript
// src/context-strategies/types.ts
export interface ContextStrategy {
  name: string;                 // e.g. "manual", "ai-assisted"
  generate(
    userMessage: string,
    tool: ToolAdapter
  ): Promise<string>;           // returns the line to append to context.md
}
```

`core/context.ts` depends only on this interface, never on a specific
strategy's implementation. Which strategy is active is a config.yaml
setting (default: `"manual"`). This is deliberately the same shape as the
tools/registry.ts pattern above — two independent axes (which AI CLI, and
how context gets written) that can each change without touching the other.

### Before implementing `manual.ts` — think about this first

The `manual.ts` approach above (log of user-written checkpoint messages) is
the safe, definitely-works default — treat it as the floor, not necessarily
the ceiling. Before writing it, take a moment to think through whether
there's a genuinely better zero-cost way to generate useful context that's
still consistent with the constraints in this file (no required API key, no
mandatory paid dependency, works fully offline, no telemetry). Some
directions worth considering, if you see a clean way to do any of them
without adding real complexity or a hard dependency:

- Can useful signal be pulled from things already on disk for free — e.g.
  recent git diff/log in the project directory, or file-change timestamps
  — to enrich the manual message rather than replace it?
- Is there a lightweight, genuinely no-cost way to let the ai-assisted
  strategy (shelling out to the user's already-authenticated CLI) be
  viable as the *default* rather than a future stub, if it turns out to
  add negligible latency/complexity? Only pursue this if it can stay
  simple — don't build a fragile integration against each tool's exact
  CLI flags just to chase this.
- Any other approach that improves on a flat message log without
  reintroducing the cost/complexity this design is deliberately avoiding.

If, after thinking it through, `manual.ts` as specified is still the right
call for the MVP (it likely is — simplicity and zero dependencies matter a
lot here), implement it as described and leave your reasoning as a comment
at the top of the file so the tradeoff is visible to future contributors.
Don't spend more than a little time on this exploration — a working
`manual.ts` beats a half-built smarter version.

### Why this matters here specifically

This project's whole pitch is supporting many AI CLIs, and that list will
keep growing — new tools launch, old ones get deprecated (as already
happened once in this space). The adapter pattern means that churn stays
contained to `src/tools/`, one file per tool, and never leaks into command
logic, storage logic, or brand/output styling. Treat `tools/registry.ts` as
the single seam between "which AI CLIs exist" and "everything else the CLI
does."

---

## `.brg/` directory structure

```
.brg/
├── context.md         Human-readable rolling summary of the project —
│                        what's been done, key decisions, open threads.
│                        This is what gets injected on `brg switch`.
├── config.yaml         Project-level settings (default tool, etc.)
└── sessions/
    └── <ISO-timestamp>.json    One file per checkpoint. Structured record:
                                  { timestamp, tool, message, contextSnapshot }
```

Keep this human-inspectable and git-diffable on purpose — a person should be
able to open `context.md` in a text editor and understand their project
history without running `brg` at all.

---

## Brand identity (for README, CLI output styling, and any docs)

- **Name:** brg (always lowercase in running text and as the command)
- **Tagline:** "Never explain yourself twice."
- **Color palette** (for terminal output styling and any generated docs/assets):
  - `paper` `#EDE9E0` — light background
  - `ink` `#1A1815` — dark background / primary text
  - `amber` `#C9762F` — accent color (use for success states, highlights,
    the active tool name, etc. — avoid the generic neon-green terminal look)
  - `ink-soft` `#55504A` — secondary/dim text
  - `line` `#D8D2C4` — borders/dividers
- **Typography:** JetBrains Mono for any rendered brand surfaces (README
  banner images, docs site, etc.) — not relevant to raw terminal output,
  which uses the user's own terminal font.
- **Logo mark:** an open ring + a filled dot, slightly overlapping — a
  full-color PNG/SVG will be provided separately; reference it from the
  README once supplied rather than recreating it from scratch.
- If you add color to CLI output (e.g. via `chalk` or `picocolors`), use
  amber for the active/success indicators and keep everything else neutral
  — don't rainbow the terminal output.

---

## Open-source project standards to follow

This repo already has these files in place — **do not overwrite them**,
but do keep them in mind and reference them appropriately from the README
and any contribution flows you build:

```
brg/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       └── ci.yml          (runs on push/PR to main — lint + test across
│                             Ubuntu/macOS/Windows, Node 18.x and 20.x)
├── .gitignore
├── CHANGELOG.md             (Keep a Changelog format — update the
│                             [Unreleased] section as you add features)
├── CODE_OF_CONDUCT.md       (Contributor Covenant v2.1 — already final)
├── CONTRIBUTING.md          (setup steps, PR flow, commit conventions —
│                             already final, but make sure `npm test` and
│                             `npm run lint` actually work as described)
├── LICENSE                  (MIT — already final)
├── README.md                (needs to be written for the MVP — see below)
└── SECURITY.md               (already final)
```

### README.md — what it needs to cover

Write (or rewrite) `README.md` to include, in this order:
1. One-line tagline + a short paragraph on what `brg` does and why
   (context loss when switching AI CLIs is the problem it solves)
2. Install instructions: `npm install -g brg`
3. Quickstart: `brg setup` → `brg init` → `brg switch claude`
4. Full command reference (the Phase 1 list above)
5. `.brg/` directory explanation (what gets stored, that it's plain files)
6. Supported tools (Claude Code, Gemini CLI, Codex, OpenCode — and note
   that support for more CLIs is community-extensible)
7. Contributing section — link to `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
8. License line — MIT

Keep it scannable — short sections, code blocks for every command example,
no marketing fluff. This is a developer tool README, not a landing page.

### package.json requirements

```json
{
  "name": "brg",
  "version": "0.1.0",
  "description": "Never explain yourself twice.",
  "license": "MIT",
  "bin": {
    "brg": "./bin/brg.js"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/brghq/brg.git"
  },
  "keywords": ["cli", "ai", "claude", "gemini", "codex", "developer-tools"]
}
```

`bin/brg.js` must start with `#!/usr/bin/env node` and needs `chmod +x` set
(or handle that in a postinstall/build step) so it works as a global command
after `npm install -g`.

### Testing

Set up a basic test runner (Vitest or Jest — pick whichever integrates more
simply with the existing TypeScript setup) with at least smoke tests for:
- `brg init` creates the expected `.brg/` structure
- `brg checkpoint` writes a valid session file
- `brg status` doesn't crash on an empty/uninitialized directory
- Command parsing (Commander.js) routes to the right handlers

`npm test` must be a working command — the CI workflow already calls it.

### Linting

Add ESLint with a reasonably standard TypeScript config. `npm run lint`
must be a working command — the CI workflow already calls it with
`--if-present`, but once you add it, make sure it actually runs and passes.

---

## Assets available on request

The maintainer has a finished logo (PNG/SVG, open-ring + filled-dot mark on
the paper/ink/amber palette) and can supply it if you need it for the
README banner or any generated docs — ask rather than generating a
placeholder logo yourself.

---

## Working style for this MVP pass

- Build the Phase 1 command list fully and correctly before adding anything
  beyond it.
- Prioritize a smooth `npm install -g brg` → `brg setup` → `brg switch
  claude` first-run experience — that flow is the entire pitch of the tool.
- Keep dependencies minimal. Every new dependency should have a clear,
  specific reason.
- Write code that a new contributor could read and understand without
  additional context beyond this file and `CONTRIBUTING.md`.

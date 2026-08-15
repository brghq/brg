# brg plugin (Claude Code)

A Claude Code plugin bundling brg's hooks and MCP server. Requires `brg`
installed and on `PATH` (`npm install -g brg-cli`) — every file here is a
thin pointer at the already-installed `brg` binary; none of the actual
logic lives in this directory.

- **`.claude-plugin/plugin.json`** — plugin manifest.
- **`hooks/hooks.json`** — wires `SessionStart` to `brg hook session-start`
  (injects the active branch's rolling summary as session context) and
  `PreCompact` to `brg hook pre-compact` (checkpoints before Claude Code
  compacts context, so nothing gets lost). Both hook commands live in
  [`src/commands/hook.ts`](../src/commands/hook.ts), tested in
  [`test/hook.test.ts`](../test/hook.test.ts) — this directory only
  configures Claude Code to call them.
- **`.mcp.json`** — registers `brg mcp` (see
  [`src/commands/mcp.ts`](../src/commands/mcp.ts)) as an MCP server:
  `context_search`, `context_commit`, `context_diff`, `context_merge`.

Codex has no equivalent plugin/hook system today, so this plugin targets
Claude Code only — same scoping as the `ToolAdapter` interface only
supporting Claude Code and Codex for now.

## Maintenance note

`plugin.json`'s `version` is not derived automatically from
`package.json` — bump both together on release.

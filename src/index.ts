// SPDX-License-Identifier: MIT
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setupCommand } from './commands/setup.js';
import { toolsListCommand } from './commands/tools.js';
import { initCommand } from './commands/init.js';
import { switchCommand } from './commands/switch.js';
import { checkpointCommand } from './commands/checkpoint.js';
import { logCommand } from './commands/log.js';
import { statusCommand } from './commands/status.js';
import { contextShowCommand } from './commands/context.js';
import { branchCommand } from './commands/branch.js';
import { checkoutCommand } from './commands/checkout.js';
import { diffCommand } from './commands/diff.js';
import { mergeCommand } from './commands/merge.js';
import { mcpCommand } from './commands/mcp.js';
import { hookCommand } from './commands/hook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('brg')
    .description('Never explain yourself twice. Switch between AI coding CLIs without losing context.')
    .version(pkg.version);

  program
    .command('setup')
    .description('Interactive wizard to install/authenticate supported AI CLIs')
    .action(setupCommand);

  const tools = program.command('tools').description('Manage registered AI CLIs');
  tools
    .command('list')
    .description('List which AI CLIs are registered/installed')
    .action(toolsListCommand);

  program
    .command('init')
    .description('Create a .brg/ directory in the current project')
    .action(initCommand);

  program
    .command('switch <tool>')
    .description('Hand off to an AI CLI, carrying project context with you')
    .option('-f, --fresh', 'skip context, start a completely clean session')
    .action(switchCommand);

  program
    .command('checkpoint <message>')
    .description('Snapshot current state with a message, like git commit')
    .option('--tool <name>', 'tool to attribute this checkpoint to')
    .action(checkpointCommand);

  program
    .command('log')
    .description('Print a timeline of checkpoints, most recent first')
    .option('--graph', 'render the branch/checkpoint graph instead of the checkpoint timeline')
    .action(logCommand);

  program
    .command('status')
    .description('Show active tool, last checkpoint, context size, and today\'s session count')
    .action(statusCommand);

  const context = program.command('context').description('Inspect project context');
  context
    .command('show')
    .description('Print the current .brg/context.md to stdout')
    .action(contextShowCommand);

  program
    .command('branch <name>')
    .description('Create a brg context branch, optionally linked to a new git branch')
    .option('--intent <text>', 'restated goal for this branch (prompted if omitted)')
    .action(branchCommand);

  program
    .command('checkout <name>')
    .description('Switch to a brg branch, checking out its linked git branch if it has one')
    .action(checkoutCommand);

  program
    .command('diff <branchA> <branchB>')
    .description('Show fact differences between two branches')
    .action(diffCommand);

  program
    .command('merge <source>')
    .description('Merge a branch\'s context into the currently active brg branch')
    .option('--auto', 'try the active tool as an LLM arbiter for conflicts before asking interactively')
    .action(mergeCommand);

  program
    .command('mcp')
    .description('Start brg\'s MCP server over stdio (context_search/commit/diff/merge)')
    .action(mcpCommand);

  program
    .command('hook <event>')
    .description('Backing command for the Claude Code plugin\'s hooks (session-start, pre-compact)')
    .action(hookCommand);

  return program;
}


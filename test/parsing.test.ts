import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/index.js';
import { listAdapters } from '../src/tools/registry.js';

describe('command parsing', () => {
  it('registers all commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(
      [
        'checkout',
        'checkpoint',
        'context',
        'dashboard',
        'diff',
        'export',
        'hook',
        'init',
        'log',
        'mcp',
        'merge',
        'setup',
        'status',
        'switch',
        'tools',
      ].sort(),
    );
  });

  it('routes "switch <tool> -f" to the switch action with fresh=true', async () => {
    let received: { tool?: string; options?: { fresh?: boolean } } = {};
    const program = buildProgram();
    program.commands
      .find((c) => c.name() === 'switch')!
      .action((tool: string, options: { fresh?: boolean }) => {
        received = { tool, options };
      });

    await program.parseAsync(['node', 'brg', 'switch', 'claude', '-f']);

    expect(received.tool).toBe('claude');
    expect(received.options?.fresh).toBe(true);
  });

  it('routes "checkpoint <message> --tool x" with the message and tool option', async () => {
    let received: { message?: string; options?: { tool?: string } } = {};
    const program = buildProgram();
    program.commands
      .find((c) => c.name() === 'checkpoint')!
      .action((message: string, options: { tool?: string }) => {
        received = { message, options };
      });

    await program.parseAsync(['node', 'brg', 'checkpoint', 'wrapped up the fix', '--tool', 'codex']);

    expect(received.message).toBe('wrapped up the fix');
    expect(received.options?.tool).toBe('codex');
  });

  it('routes "tools list" and "context show" subcommands', async () => {
    let toolsListCalled = false;
    let contextShowCalled = false;

    const program = buildProgram();
    program.commands
      .find((c) => c.name() === 'tools')!
      .commands.find((c) => c.name() === 'list')!
      .action(() => {
        toolsListCalled = true;
      });
    program.commands
      .find((c) => c.name() === 'context')!
      .commands.find((c) => c.name() === 'show')!
      .action(() => {
        contextShowCalled = true;
      });

    await program.parseAsync(['node', 'brg', 'tools', 'list']);
    await program.parseAsync(['node', 'brg', 'context', 'show']);

    expect(toolsListCalled).toBe(true);
    expect(contextShowCalled).toBe(true);
  });

  it('registers exactly the two supported tool adapters', () => {
    const names = listAdapters().map((a) => a.name).sort();
    expect(names).toEqual(['claude', 'codex']);
  });

  it('routes "checkout <name> --inherit --git" with the parsed flags', async () => {
    let received: { name?: string; options?: Record<string, unknown> } = {};
    const program = buildProgram();
    program.commands
      .find((c) => c.name() === 'checkout')!
      .action((name: string, options: Record<string, unknown>) => {
        received = { name, options };
      });

    await program.parseAsync(['node', 'brg', 'checkout', 'feature-x', '--inherit', '--git']);

    expect(received.name).toBe('feature-x');
    expect(received.options?.inherit).toBe(true);
    expect(received.options?.git).toBe(true);
  });

  it('routes "diff <name>" (one arg) with the second arg undefined', async () => {
    let received: unknown[] = [];
    const program = buildProgram();
    program.commands
      .find((c) => c.name() === 'diff')!
      .action((...args: unknown[]) => {
        received = args;
      });

    await program.parseAsync(['node', 'brg', 'diff', 'feature-x']);

    expect(received[0]).toBe('feature-x');
    expect(received[1]).toBeUndefined();
  });

  it('routes "log --all --graph" with both flags true', async () => {
    let received: { options?: Record<string, unknown> } = {};
    const program = buildProgram();
    program.commands
      .find((c) => c.name() === 'log')!
      .action((options: Record<string, unknown>) => {
        received = { options };
      });

    await program.parseAsync(['node', 'brg', 'log', '--all', '--graph']);

    expect(received.options?.all).toBe(true);
    expect(received.options?.graph).toBe(true);
  });
});

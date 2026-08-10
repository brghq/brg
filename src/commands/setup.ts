import readline from 'node:readline/promises';
import { listAdapters, getAdapter } from '../tools/registry.js';
import { amber, dim, bold } from '../utils/style.js';

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function setupCommand(): Promise<void> {
  console.log(bold('brg setup') + dim(' — pick which AI CLIs to set up.\n'));

  const adapters = listAdapters();
  for (const tool of adapters) {
    console.log(`  ${dim(tool.name.padEnd(10))} ${tool.displayName}`);
  }

  const answer = await ask(
    `\nWhich tools do you want set up? (comma-separated names, or "all") `,
  );

  const selected =
    answer.toLowerCase() === 'all' || answer === ''
      ? adapters.map((a) => a.name)
      : answer.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  for (const name of selected) {
    const tool = getAdapter(name);
    if (!tool) {
      console.log(`${dim('skip')} unknown tool "${name}"`);
      continue;
    }

    console.log(`\n${bold(tool.displayName)}`);

    // Detect-then-act: never reinstall or re-trigger login for a tool
    // that's already set up.
    if (tool.isInstalled()) {
      console.log(`  ${amber('✓')} already installed`);
    } else {
      console.log(`  installing...`);
      await tool.install();
    }

    if (tool.isInstalled() && tool.isLoggedIn()) {
      console.log(`  ${amber('✓')} already authenticated`);
    } else if (tool.isInstalled()) {
      console.log(`  logging in...`);
      await tool.login();
    }
  }

  console.log(`\n${amber('✓')} Setup complete. Run "brg init" inside a project to get started.`);
}

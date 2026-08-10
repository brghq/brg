import { listAdapters } from '../tools/registry.js';
import { amber, dim } from '../utils/style.js';

export function toolsListCommand(): void {
  for (const tool of listAdapters()) {
    const installed = tool.isInstalled();
    const loggedIn = installed && tool.isLoggedIn();
    const status = installed
      ? loggedIn
        ? amber('installed, authenticated')
        : `installed, ${dim('not authenticated')}`
      : dim('not installed');
    console.log(`${tool.name.padEnd(10)} ${tool.displayName.padEnd(14)} ${status}`);
  }
}

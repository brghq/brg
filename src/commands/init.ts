import fs from 'node:fs';
import { brgDir, configPath, writeConfig, isInitialized } from '../core/config.js';
import { initContext } from '../core/context.js';
import { sessionsDir } from '../core/session.js';
import { installPostCheckoutHook } from '../versioning/hook.js';
import { amber, dim } from '../utils/style.js';

export function initCommand(): void {
  if (isInitialized()) {
    console.log(dim('brg is already initialized here — nothing to do.'));
    // Still worth installing on a re-run: covers a project that was
    // `brg init`-ed before this hook existed, or before it became a git
    // repo. Idempotent either way.
    installPostCheckoutHook();
    return;
  }

  fs.mkdirSync(brgDir(), { recursive: true });
  fs.mkdirSync(sessionsDir(), { recursive: true });
  initContext();
  if (!fs.existsSync(configPath())) {
    // ai-assisted degrades all the way down to manual's own output when
    // nothing richer is available, so it's a safe default for new projects.
    writeConfig({ contextStrategy: 'ai-assisted' });
  }
  installPostCheckoutHook();

  console.log(`${amber('✓')} Initialized .brg/ in ${process.cwd()}`);
}

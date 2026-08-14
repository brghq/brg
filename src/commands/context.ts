import { isInitialized } from '../core/config.js';
import { readContext } from '../core/context.js';
import { dim } from '../utils/style.js';

export function contextShowCommand(): void {
  if (!isInitialized()) {
    console.error('brg: this project hasn\'t been initialized yet. Run "brg init" first.');
    process.exitCode = 1;
    return;
  }

  const content = readContext();
  if (!content) {
    console.log(dim('(context.md is empty)'));
    return;
  }
  process.stdout.write(content);
}

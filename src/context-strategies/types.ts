import type { ToolAdapter } from '../tools/types.js';

export interface ContextStrategy {
  name: string;
  generate(userMessage: string, tool: ToolAdapter): Promise<string>;
}

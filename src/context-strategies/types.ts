import type { ToolAdapter } from '../tools/types.js';
import type { CheckpointSource } from '../versioning/types.js';

export interface ContextStrategyResult {
  text: string;
  source: CheckpointSource;
}

export interface ContextStrategy {
  name: string;
  generate(userMessage: string, tool: ToolAdapter): Promise<ContextStrategyResult>;
}

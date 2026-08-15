import type { ToolAdapter } from '../tools/types.js';
import type { CheckpointSource, Fact, FactOp } from '../versioning/types.js';

export interface ContextStrategyResult {
  text: string;
  source: CheckpointSource;
  // Structured facts established/changed in this session, if the
  // strategy was able to extract any. Only a live model call can
  // produce these — pure-local tiers (transcript extract, manual) always
  // return []. See ai-assisted.ts for where this actually gets filled in.
  factsDelta: FactOp[];
}

export interface ContextStrategy {
  name: string;
  // existingFacts is the branch's current fact set, passed in so a
  // strategy that can extract facts only reports what's new/changed
  // instead of re-stating everything every checkpoint.
  generate(userMessage: string, tool: ToolAdapter, existingFacts: Fact[]): Promise<ContextStrategyResult>;
}

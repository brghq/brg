export interface TranscriptExtract {
  text: string;
  truncated: boolean;
  sourcePath: string;
}

export interface ToolAdapter {
  name: string;
  displayName: string;
  isInstalled(): boolean;
  install(): Promise<void>;
  isLoggedIn(): boolean;
  login(): Promise<void>;
  launch(contextText?: string): void;

  // Both optional, and both MUST NOT throw — `null`/rejection-free failure
  // means "unavailable right now," so the ai-assisted context strategy can
  // fall through to the next tier instead of the checkpoint failing outright.
  // Adapters that skip these fall straight through to the manual strategy.
  getLatestTranscript?(cwd: string): TranscriptExtract | null;
  summarizeViaSelf?(instruction: string): Promise<string | null>;
}

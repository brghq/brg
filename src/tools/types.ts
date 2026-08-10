export interface ToolAdapter {
  name: string;
  displayName: string;
  isInstalled(): boolean;
  install(): Promise<void>;
  isLoggedIn(): boolean;
  login(): Promise<void>;
  launch(contextText?: string): void;
}

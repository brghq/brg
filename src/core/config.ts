import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface BrgConfig {
  defaultTool?: string;
  contextStrategy: string;
}

const DEFAULT_CONFIG: BrgConfig = {
  // ai-assisted degrades all the way down to manual's own output when
  // nothing richer is available, so it's a strict superset — safe default.
  contextStrategy: 'ai-assisted',
};

export function brgDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.brg');
}

export function configPath(cwd: string = process.cwd()): string {
  return path.join(brgDir(cwd), 'config.yaml');
}

export function isInitialized(cwd: string = process.cwd()): boolean {
  return fs.existsSync(brgDir(cwd));
}

export function readConfig(cwd: string = process.cwd()): BrgConfig {
  const file = configPath(cwd);
  if (!fs.existsSync(file)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = (yaml.load(raw) as Partial<BrgConfig>) ?? {};
  return { ...DEFAULT_CONFIG, ...parsed };
}

export function writeConfig(config: BrgConfig, cwd: string = process.cwd()): void {
  fs.writeFileSync(configPath(cwd), yaml.dump(config), 'utf8');
}

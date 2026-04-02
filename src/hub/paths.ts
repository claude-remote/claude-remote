import { homedir } from 'node:os';
import { join } from 'node:path';

export function getHubRootDir(): string {
  return join(homedir(), '.claude-remote');
}

export function getHubSocketPath(): string {
  return join(getHubRootDir(), 'hub.sock');
}

export function getHubStatusPath(): string {
  return join(getHubRootDir(), 'hub-status.json');
}

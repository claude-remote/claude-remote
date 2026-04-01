export type LspServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export type LspServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  workspaceFolder?: string;
  extensionToLanguage?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
  maxRestarts?: number;
  restartOnCrash?: boolean;
  shutdownTimeout?: number;
  [key: string]: unknown;
};

export type ScopedLspServerConfig = LspServerConfig & {
  name?: string;
  scope?: string;
  pluginName?: string;
  pluginSource?: string;
};

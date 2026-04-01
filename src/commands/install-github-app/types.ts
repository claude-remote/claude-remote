export type Workflow = 'claude' | 'claude-review';

export type Warning = {
  title: string;
  message: string;
  instructions: string[];
};

export type State = any;
export type InstallGitHubAppState = any;
export type RepoSelection = any;
export type WorkflowSetupResult = any;

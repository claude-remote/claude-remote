type CollapseStats = {
  collapsedSpans: number;
  collapsedMessages: number;
  stagedSpans: number;
  health: {
    totalErrors: number;
    totalSpawns: number;
    totalEmptySpawns: number;
    emptySpawnWarningEmitted: boolean;
    lastError?: string;
  };
};

const defaultStats: CollapseStats = {
  collapsedSpans: 0,
  collapsedMessages: 0,
  stagedSpans: 0,
  health: {
    totalErrors: 0,
    totalSpawns: 0,
    totalEmptySpawns: 0,
    emptySpawnWarningEmitted: false,
  },
};

export function getStats(): CollapseStats {
  return defaultStats;
}

export function isContextCollapseEnabled(): boolean {
  return false;
}

export function subscribe(_listener: () => void): () => void {
  return () => {};
}

export async function applyCollapsesIfNeeded(...args: any[]): Promise<{
  messages: any[];
}> {
  return { messages: args[0] ?? [] };
}

export function isWithheldPromptTooLong(..._args: any[]): boolean {
  return false;
}

export function recoverFromOverflow(...args: any[]): {
  committed: number;
  messages: any[];
} {
  return { committed: 0, messages: args[0] ?? [] };
}

export function resetContextCollapse(): void {}

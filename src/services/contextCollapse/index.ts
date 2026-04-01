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

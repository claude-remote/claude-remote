import { useState } from 'react';

import type { CostSummary } from '@/shared/types';

interface CostBadgeProps {
  cost: CostSummary;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

export function CostBadge({ cost }: CostBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative">
      {/* Compact badge */}
      <button
        type="button"
        className="rounded bg-stone-900 px-3 py-2 text-sm text-gray-300 hover:bg-stone-800 transition-colors"
        onClick={() => setExpanded(!expanded)}
        title="Session cost - click for details"
      >
        {cost.formattedCost}
      </button>

      {/* Detail popup */}
      {expanded && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl">
          <div className="pb-2 text-xs font-medium text-gray-400">Cost Breakdown</div>

          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">Session cost</span>
              <span className="font-mono text-gray-200">{cost.formattedCost}</span>
            </div>

            <hr className="border-gray-800" />

            <div className="flex justify-between">
              <span className="text-gray-400">Input tokens</span>
              <span className="font-mono text-gray-300">{formatTokens(cost.inputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Output tokens</span>
              <span className="font-mono text-gray-300">{formatTokens(cost.outputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">API calls</span>
              <span className="font-mono text-gray-300">{cost.apiCalls}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Duration</span>
              <span className="font-mono text-gray-300">{formatDuration(cost.sessionDuration)}</span>
            </div>
          </div>

          <button
            type="button"
            className="mt-2 w-full text-center text-xs text-gray-600 hover:text-gray-400"
            onClick={() => setExpanded(false)}
          >
            click to close
          </button>
        </div>
      )}
    </div>
  );
}

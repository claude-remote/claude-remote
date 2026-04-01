import { useState } from 'react';

import type { ContextUsage } from '@/shared/types';

interface ContextIndicatorProps {
  usage: ContextUsage;
  modelName?: string;
}

function usageColor(percentage: number): string {
  if (percentage >= 80) return 'bg-red-500';
  if (percentage >= 60) return 'bg-yellow-500';
  return 'bg-green-500';
}

function usageTextColor(percentage: number): string {
  if (percentage >= 80) return 'text-red-400';
  if (percentage >= 60) return 'text-yellow-400';
  return 'text-green-400';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ContextIndicator({ usage, modelName }: ContextIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  const pct = Math.min(usage.percentage, 100);
  const label = modelName ? `${modelName} \u00b7 ${pct.toFixed(0)}%` : `${pct.toFixed(0)}%`;

  return (
    <div className="relative">
      {/* Compact bar */}
      <button
        type="button"
        className="flex items-center gap-2 rounded bg-stone-900 px-3 py-2 text-sm hover:bg-stone-800 transition-colors"
        onClick={() => setExpanded(!expanded)}
        title="Context usage - click for details"
      >
        <span className="text-gray-300">{label}</span>
        {/* Mini progress bar */}
        <div className="h-1.5 w-16 rounded-full bg-stone-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${usageColor(pct)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>

      {/* Detail popup */}
      {expanded && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-gray-400">Context Usage</span>
            <span className={`text-xs font-bold ${usageTextColor(pct)}`}>
              {pct.toFixed(1)}%
            </span>
          </div>

          {/* Token summary */}
          <div className="pb-2 text-xs text-gray-300">
            {formatTokens(usage.usedTokens)} / {formatTokens(usage.maxTokens)} tokens
          </div>

          {/* Full progress bar */}
          <div className="h-2 w-full rounded-full bg-stone-700 overflow-hidden mb-3">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${usageColor(pct)}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Breakdown */}
          {usage.breakdown.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-gray-500">Breakdown</span>
              {usage.breakdown.map((item) => {
                const itemPct = usage.maxTokens > 0
                  ? (item.tokens / usage.maxTokens) * 100
                  : 0;
                return (
                  <div key={item.label} className="flex items-center gap-2 text-xs">
                    <span className="w-20 truncate text-gray-400" title={item.label}>
                      {item.label}
                    </span>
                    <div className="h-1 flex-1 rounded-full bg-stone-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width: `${Math.min(itemPct, 100)}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-gray-500">
                      {formatTokens(item.tokens)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Close hint */}
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

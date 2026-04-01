import type { ContextUsage, CostSummary, SessionConfig } from '@/shared/types';

import { ContextIndicator } from './ContextIndicator';
import { CostBadge } from './CostBadge';

interface StatusBarProps {
  config: SessionConfig;
  usage: ContextUsage;
  cost: CostSummary;
}

export function StatusBar({ config, usage, cost }: StatusBarProps) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-gray-800 bg-gray-950 px-3 py-1.5">
      {/* Left: model name + context indicator */}
      <div className="flex items-center gap-2 min-w-0">
        <ContextIndicator usage={usage} modelName={config.model} />
      </div>

      {/* Right: cost badge */}
      <div className="shrink-0">
        <CostBadge cost={cost} />
      </div>
    </div>
  );
}

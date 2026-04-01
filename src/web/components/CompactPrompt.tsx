import { useState } from 'react';

import type { ContextUsage } from '@/shared/types';

interface CompactPromptProps {
  usage: ContextUsage;
  onCompact?: () => void;
}

export function CompactPrompt({ usage, onCompact }: CompactPromptProps) {
  const [dismissed, setDismissed] = useState(false);

  if (usage.percentage < 80 || dismissed) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm">
      <span className="text-yellow-200">
        Context is {usage.percentage.toFixed(0)}% full. Compact conversation?
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          className="rounded bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-500 transition-colors"
          onClick={() => onCompact?.()}
        >
          Compact
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

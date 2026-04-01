import type { ContextUsage } from '@/shared/types';

interface ContextIndicatorProps {
  usage: ContextUsage;
}

export function ContextIndicator({ usage }: ContextIndicatorProps) {
  // TODO(T20): render progress, breakdown popover, and compact CTA when usage grows.
  return (
    <div className="rounded bg-stone-900 px-3 py-2 text-sm">
      Context {usage.percentage.toFixed(0)}%
    </div>
  );
}

import type { CostSummary } from '@/shared/types';

interface CostBadgeProps {
  cost: CostSummary;
}

export function CostBadge({ cost }: CostBadgeProps) {
  // TODO(T20): expand into detailed token/cost breakdowns and runtime metrics.
  return <div className="rounded bg-stone-900 px-3 py-2 text-sm">{cost.formattedCost}</div>;
}

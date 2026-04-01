import type { ContextUsage } from '@/shared/types';

interface CompactPromptProps {
  usage: ContextUsage;
}

export function CompactPrompt({ usage }: CompactPromptProps) {
  // TODO(T20,T22): trigger chat:compact once the threshold-based UI is final.
  if (usage.percentage < 80) {
    return null;
  }

  return (
    <div className="rounded border border-orange-500/50 bg-orange-500/10 p-3 text-sm">
      上下文接近上限，建议压缩历史。
    </div>
  );
}

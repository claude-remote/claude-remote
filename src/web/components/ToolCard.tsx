import type { Message } from '@/shared/types';

interface ToolCardProps {
  title: string;
  body: string;
  sourceMessage?: Message;
}

export function ToolCard({ title, body }: ToolCardProps) {
  // TODO(T15): add collapsible terminal output, diff rendering, and execution states.
  return (
    <div className="rounded border border-stone-700 bg-stone-900 p-3">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-2 text-sm text-stone-300">{body}</p>
    </div>
  );
}

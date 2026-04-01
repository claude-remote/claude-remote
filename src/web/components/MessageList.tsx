import type { Message } from '@/shared/types';

import { StreamingText } from '@/web/components/StreamingText';
import { ToolCard } from '@/web/components/ToolCard';

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  // TODO(T14,T15): render markdown, tool cards, and reverse infinite history loading.
  return (
    <section className="space-y-3">
      {messages.length === 0 ? <StreamingText text="等待第一条消息..." /> : null}
      {messages.map((message) => (
        <article key={message.id} className="rounded border border-stone-800 p-3">
          <p className="text-xs uppercase text-stone-400">{message.role}</p>
          <StreamingText text={JSON.stringify(message.content)} />
          <ToolCard title="Tool output placeholder" body="TODO(T15): render tool content blocks." />
        </article>
      ))}
    </section>
  );
}

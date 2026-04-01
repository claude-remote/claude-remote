import { useCallback, useEffect, useRef } from 'react';

import type { Message, MessageContentBlock } from '@/shared/types';

import { StreamingText } from '@/web/components/StreamingText';
import { ToolCard } from '@/web/components/ToolCard';

interface MessageListProps {
  messages: Message[];
  isStreaming?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

function roleIcon(role: Message['role']): string {
  switch (role) {
    case 'user':
      return 'U';
    case 'assistant':
      return 'A';
    case 'system':
      return 'S';
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderContentBlock(
  block: MessageContentBlock,
  index: number,
  isLast: boolean,
  isStreaming: boolean,
): React.ReactNode {
  switch (block.type) {
    case 'text':
      return (
        <StreamingText key={index} text={block.text} isStreaming={isLast && isStreaming} />
      );
    case 'tool_use':
      return (
        <ToolCard
          key={index}
          title={block.name}
          body={JSON.stringify(block.input, null, 2)}
        />
      );
    case 'tool_result':
      return (
        <ToolCard
          key={index}
          title={block.isError ? 'Error' : 'Result'}
          body={typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
        />
      );
    case 'image':
      return (
        <img
          key={index}
          src={
            block.source.type === 'base64'
              ? `data:${block.source.mediaType};base64,${block.source.data}`
              : block.source.data
          }
          alt="content"
          className="max-h-64 rounded"
        />
      );
    default:
      return null;
  }
}

export function MessageList({
  messages,
  isStreaming = false,
  onLoadMore,
  hasMore = false,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Pull-to-load: detect scroll to top
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !hasMore || !onLoadMore) return;
    if (el.scrollTop < 80) {
      onLoadMore();
    }
  }, [hasMore, onLoadMore]);

  if (messages.length === 0) {
    return (
      <section className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-500">Start a conversation</p>
      </section>
    );
  }

  return (
    <section
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4"
    >
      {hasMore && (
        <div className="py-2 text-center text-xs text-gray-500">Loading older messages...</div>
      )}

      {messages.map((message, msgIndex) => {
        const isLastMessage = msgIndex === messages.length - 1;
        const isAssistant = message.role === 'assistant';
        const isUser = message.role === 'user';
        const isSystem = message.role === 'system';

        if (isSystem) {
          return (
            <div key={message.id} className="flex justify-center">
              <div className="max-w-md rounded-lg px-4 py-2 text-center text-xs text-gray-500">
                {message.content.map((block, i) => renderContentBlock(block, i, false, false))}
                <span className="mt-1 block text-[10px] text-gray-600">
                  {formatTime(message.createdAt)}
                </span>
              </div>
            </div>
          );
        }

        return (
          <div
            key={message.id}
            className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`flex max-w-[85%] gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Role icon */}
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  isAssistant
                    ? 'bg-gray-700 text-gray-300'
                    : 'bg-indigo-700 text-indigo-200'
                }`}
              >
                {roleIcon(message.role)}
              </div>

              {/* Message bubble */}
              <div
                className={`min-w-0 rounded-lg border px-3 py-2 ${
                  isUser
                    ? 'border-indigo-900/50 bg-indigo-900/50'
                    : 'border-gray-800/50 bg-gray-800/50'
                }`}
              >
                <div className="space-y-2">
                  {message.content.map((block, i) =>
                    renderContentBlock(
                      block,
                      i,
                      isLastMessage && i === message.content.length - 1,
                      isStreaming && isAssistant,
                    ),
                  )}
                </div>
                <div
                  className={`mt-1 text-[10px] ${isUser ? 'text-right' : 'text-left'} text-gray-500`}
                >
                  {formatTime(message.createdAt)}
                  {message.model && isAssistant && (
                    <span className="ml-2">{message.model}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </section>
  );
}

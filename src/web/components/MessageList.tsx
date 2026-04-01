import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Message, MessageContentBlock } from '@/shared/types';

import { StreamingText } from '@/web/components/StreamingText';
import { ToolCard } from '@/web/components/ToolCard';
import { VirtualMessageList } from '@/web/components/VirtualMessageList';

interface MessageListProps {
  messages: Message[];
  isStreaming?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  onMessageContextMenu?: (e: React.MouseEvent, messageId: string, message: Message) => void;
  onMessageTouchStart?: (e: React.TouchEvent, messageId: string, message: Message) => void;
  onMessageTouchEnd?: () => void;
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

/**
 * Build a lookup from toolUseId -> ToolResultContentBlock across all messages,
 * so we can pair tool_use blocks with their results.
 */
function buildToolResultMap(
  messages: Message[],
): Map<string, import('@/shared/types').ToolResultContentBlock> {
  const map = new Map<string, import('@/shared/types').ToolResultContentBlock>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        map.set(block.toolUseId, block);
      }
    }
  }
  return map;
}

function renderContentBlock(
  block: MessageContentBlock,
  index: number,
  isLast: boolean,
  isStreaming: boolean,
  toolResultMap?: Map<string, import('@/shared/types').ToolResultContentBlock>,
  messageCreatedAt?: number,
): React.ReactNode {
  switch (block.type) {
    case 'text':
      return <StreamingText key={index} text={block.text} isStreaming={isLast && isStreaming} />;
    case 'tool_use': {
      const result = toolResultMap?.get(block.id);
      const status = result
        ? result.isError
          ? ('failed' as const)
          : ('completed' as const)
        : isStreaming
          ? ('running' as const)
          : ('completed' as const);
      return (
        <ToolCard
          key={index}
          toolUse={block}
          toolResult={result}
          status={status}
          startedAt={messageCreatedAt}
          finishedAt={result ? messageCreatedAt : undefined}
        />
      );
    }
    case 'tool_result':
      // tool_result blocks are rendered inline with their tool_use via pairing above.
      // Only render standalone if no matching tool_use was found.
      return null;
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

/** Memoized individual message row to avoid re-renders when other messages change. */
interface MessageRowProps {
  message: Message;
  isLastMessage: boolean;
  isStreaming: boolean;
  toolResultMap: Map<string, import('@/shared/types').ToolResultContentBlock>;
  onContextMenu?: (e: React.MouseEvent, messageId: string, message: Message) => void;
  onTouchStart?: (e: React.TouchEvent, messageId: string, message: Message) => void;
  onTouchEnd?: () => void;
}

const MessageRow = React.memo(function MessageRow({
  message,
  isLastMessage,
  isStreaming,
  toolResultMap,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
}: MessageRowProps) {
  const isAssistant = message.role === 'assistant';
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="max-w-md rounded-lg px-4 py-2 text-center text-xs text-gray-500">
          {message.content.map((block, i) =>
            renderContentBlock(block, i, false, false, toolResultMap, message.createdAt),
          )}
          <span className="mt-1 block text-[10px] text-gray-600">
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, message.id, message) : undefined}
      onTouchStart={onTouchStart ? (e) => onTouchStart(e, message.id, message) : undefined}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div className={`flex max-w-[85%] gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Role icon */}
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
            isAssistant ? 'bg-gray-700 text-gray-300' : 'bg-indigo-700 text-indigo-200'
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
                toolResultMap,
                message.createdAt,
              ),
            )}
          </div>
          <div
            className={`mt-1 text-[10px] ${isUser ? 'text-right' : 'text-left'} text-gray-500`}
          >
            {formatTime(message.createdAt)}
            {message.model && isAssistant && <span className="ml-2">{message.model}</span>}
          </div>
        </div>
      </div>
    </div>
  );
});

/** Threshold for switching to virtual scrolling */
const VIRTUAL_THRESHOLD = 50;

export const MessageList = React.memo(function MessageList({
  messages,
  isStreaming = false,
  onLoadMore,
  hasMore = false,
  onMessageContextMenu,
  onMessageTouchStart,
  onMessageTouchEnd,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages]);

  // Auto-scroll to bottom on new messages (non-virtual mode)
  useEffect(() => {
    if (messages.length < VIRTUAL_THRESHOLD) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Pull-to-load: detect scroll to top (non-virtual mode)
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

  // For large conversations, use virtual scrolling
  if (messages.length >= VIRTUAL_THRESHOLD) {
    return (
      <VirtualMessageList
        itemCount={messages.length}
        estimatedItemHeight={80}
        overscan={5}
        autoScrollThreshold={100}
        onScrollToTop={hasMore ? onLoadMore : undefined}
        className="flex-1 px-3 py-4"
        renderItem={(index) => {
          const message = messages[index];
          return (
            <div className="py-1.5">
              <MessageRow
                message={message}
                isLastMessage={index === messages.length - 1}
                isStreaming={isStreaming}
                toolResultMap={toolResultMap}
              />
            </div>
          );
        }}
      />
    );
  }

  // Standard rendering for small conversations
  return (
    <section
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4"
    >
      {hasMore && (
        <div className="py-2 text-center text-xs text-gray-500">Loading older messages...</div>
      )}

      {messages.map((message, msgIndex) => (
        <MessageRow
          key={message.id}
          message={message}
          isLastMessage={msgIndex === messages.length - 1}
          isStreaming={isStreaming}
          toolResultMap={toolResultMap}
          onContextMenu={onMessageContextMenu}
          onTouchStart={onMessageTouchStart}
          onTouchEnd={onMessageTouchEnd}
        />
      ))}

      <div ref={bottomRef} />
    </section>
  );
});

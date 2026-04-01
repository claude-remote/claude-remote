import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ConfigOptions,
  ContextUsage,
  CostSummary,
  McpServerInfo,
  Message,
  PermissionRequest,
  SessionConfig,
  SessionMeta,
  SkillInfo,
  StreamDelta,
  WriterStatus,
} from '@/shared/types';
import type { HubEvent, HubResponse } from '@/shared/protocol';

import { useChatStore } from '@/web/stores/chatStore';
import { useSessionStore } from '@/web/stores/sessionStore';
import { useWebSocket } from '@/web/hooks/useWebSocket';

import { BranchMenu } from '@/web/components/BranchMenu';
import { ChatInput } from '@/web/components/ChatInput';
import { CompactPrompt } from '@/web/components/CompactPrompt';
import { ContextIndicator } from '@/web/components/ContextIndicator';
import { CostBadge } from '@/web/components/CostBadge';
import { ExportDialog } from '@/web/components/ExportDialog';
import { McpPanel } from '@/web/components/McpPanel';
import { MessageList } from '@/web/components/MessageList';
import { ModelSelector } from '@/web/components/ModelSelector';
import { NotificationCenter } from '@/web/components/NotificationCenter';
import { PermissionBanner } from '@/web/components/PermissionBanner';
import { SettingsDrawer } from '@/web/components/SettingsDrawer';
import { SkillPalette } from '@/web/components/SkillPalette';

function getSessionIdFromPath(): string {
  const parts = globalThis.location?.pathname?.split('/') ?? [];
  // /chat/:sessionId
  return parts[2] || '';
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function Chat() {
  const sessionId = useMemo(() => getSessionIdFromPath(), []);
  const { connected, lastMessage, sendCommand } = useWebSocket();
  const { messages, setMessages } = useChatStore();
  const { activeSnapshot, setSnapshot } = useSessionStore();

  const [isStreaming, setIsStreaming] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const connectionStatus: ConnectionStatus = connected ? 'connected' : 'disconnected';

  // Derive state from snapshot or use defaults
  const session: SessionMeta = activeSnapshot?.meta ?? {
    id: sessionId,
    name: 'New Session',
    cwd: '~/project',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    clientCount: 0,
    hasActiveWriter: false,
  };
  const config: SessionConfig = activeSnapshot?.config ?? {
    model: 'claude-sonnet',
    effortLevel: 'medium',
    permissionMode: 'ask',
  };
  const options: ConfigOptions = activeSnapshot?.configOptions ?? {
    availableModels: [],
    effortLevels: ['low', 'medium', 'high'],
    permissionModes: ['ask', 'approve', 'bypass'],
  };
  const usage: ContextUsage = activeSnapshot?.contextUsage ?? {
    usedTokens: 0,
    maxTokens: 0,
    percentage: 0,
    breakdown: [],
  };
  const cost: CostSummary = activeSnapshot?.costSummary ?? {
    sessionCost: 0,
    formattedCost: '$0.00',
    inputTokens: 0,
    outputTokens: 0,
    apiCalls: 0,
    sessionDuration: 0,
  };
  const permissions: PermissionRequest[] = activeSnapshot?.pendingPermissions ?? [];
  const writerStatus: WriterStatus = activeSnapshot?.myWriterStatus ?? 'standby';
  const skills: SkillInfo[] = activeSnapshot?.availableSkills ?? [];
  const servers: McpServerInfo[] = activeSnapshot?.mcpServers ?? [];

  // Process incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    const msg = lastMessage as HubResponse;

    if (msg.type === 'snapshot') {
      setSnapshot(msg.snapshot);
      setMessages(msg.snapshot.recentMessages);
      setHasMore(msg.snapshot.recentMessages.length >= 50);
      return;
    }

    if (msg.type === 'event') {
      const event = msg.event as HubEvent;

      if (event.type === 'sdk:message') {
        const payload = event.payload;
        // Handle streaming deltas
        if (payload.type === 'assistant:delta') {
          setIsStreaming(true);
          const delta = payload as unknown as { type: string; delta: StreamDelta };
          setMessages(
            applyDelta(messages, delta.delta),
          );
        } else if (payload.type === 'assistant:done') {
          setIsStreaming(false);
        } else if (payload.type === 'message:added') {
          const addedMsg = payload as unknown as { type: string; message: Message };
          setMessages([...messages, addedMsg.message]);
        }
      }
    }
  }, [lastMessage, messages, setMessages, setSnapshot]);

  const handleSend = useCallback(
    (text: string) => {
      sendCommand({
        cmdId: `chat-${Date.now()}`,
        cmd: 'chat',
        text,
      });
    },
    [sendCommand],
  );

  const handleAbort = useCallback(() => {
    sendCommand({
      cmdId: `abort-${Date.now()}`,
      cmd: 'chat:abort',
    });
    setIsStreaming(false);
  }, [sendCommand]);

  const handlePermissionRespond = useCallback(
    (requestId: string, approved: boolean) => {
      sendCommand({
        cmdId: `perm-${Date.now()}`,
        cmd: 'control:respond',
        requestId,
        response: {
          type: 'control_response',
          requestId,
          response: { approved },
        },
      });
    },
    [sendCommand],
  );

  const handleLoadMore = useCallback(() => {
    // Pagination: request older messages
    // This would send a history command; for now it's a no-op placeholder
    setHasMore(false);
  }, []);

  return (
    <main className="flex h-[100dvh] flex-col bg-gray-950">
      {/* Header */}
      <header className="shrink-0 border-b border-gray-800 px-4 py-2">
        <div className="flex items-center justify-between">
          <h1 className="truncate text-lg font-semibold text-gray-100">{session.name}</h1>
          <div className="flex items-center gap-2">
            <NotificationCenter />
            <span
              className={`h-2 w-2 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-green-500'
                  : connectionStatus === 'connecting'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-red-500'
              }`}
              title={connectionStatus}
            />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <ModelSelector config={config} options={options} />
          <ContextIndicator usage={usage} />
          <CostBadge cost={cost} />
        </div>
      </header>

      {/* Banners */}
      <div className="shrink-0 space-y-1 px-3 pt-1">
        <PermissionBanner requests={permissions} writerStatus={writerStatus} onRespond={handlePermissionRespond} />
        <CompactPrompt usage={usage} />
      </div>

      {/* Message list */}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
      />

      {/* Floating panels / dialogs */}
      <SkillPalette skills={skills} />
      <BranchMenu session={session} />
      <ExportDialog />
      <McpPanel servers={servers} />
      <SettingsDrawer config={config} servers={servers} />

      {/* Input bar - fixed at bottom, with padding for the fixed element */}
      <div className="shrink-0 h-16" />
      <ChatInput
        onSend={handleSend}
        onAbort={handleAbort}
        isStreaming={isStreaming}
        disabled={!connected}
      />
    </main>
  );
}

/** Apply a streaming delta to the messages array, mutating the last assistant message. */
function applyDelta(messages: Message[], delta: StreamDelta): Message[] {
  const updated = [...messages];
  const lastMsg = updated[updated.length - 1];

  if (!lastMsg || lastMsg.role !== 'assistant') {
    // Create a new assistant message for the delta
    const newMsg: Message = {
      id: delta.messageId,
      role: 'assistant',
      content: [{ type: 'text', text: delta.text ?? '' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return [...updated, newMsg];
  }

  // Append text to the existing last assistant message
  const contentBlock = lastMsg.content[delta.contentBlockIndex];
  if (contentBlock && contentBlock.type === 'text' && delta.text) {
    const updatedMsg: Message = {
      ...lastMsg,
      content: lastMsg.content.map((block, i) =>
        i === delta.contentBlockIndex && block.type === 'text'
          ? { ...block, text: block.text + delta.text }
          : block,
      ),
      updatedAt: Date.now(),
    };
    updated[updated.length - 1] = updatedMsg;
  } else if (delta.text && !contentBlock) {
    // New content block
    const updatedMsg: Message = {
      ...lastMsg,
      content: [...lastMsg.content, { type: 'text', text: delta.text }],
      updatedAt: Date.now(),
    };
    updated[updated.length - 1] = updatedMsg;
  }

  return updated;
}

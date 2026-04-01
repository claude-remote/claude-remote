import { useCallback, useEffect, useMemo, useRef, startTransition, useState } from 'react';

import type {
  ConfigOptions,
  ContextUsage,
  CostSummary,
  ExportResult,
  McpServerInfo,
  Message,
  PermissionRequest,
  SessionConfig,
  SessionMeta,
  SkillInfo,
  StreamDelta,
  Task,
  WriterStatus,
} from '@/shared/types';
import type { HubEvent, HubResponse } from '@/shared/protocol';

import { useChatStore } from '@/web/stores/chatStore';
import { useSessionStore } from '@/web/stores/sessionStore';
import { useWebSocket } from '@/web/hooks/useWebSocket';
import { usePushNotificationFromMessages } from '@/web/hooks/usePushNotifications';

import { BranchMenu, useBranchMenu } from '@/web/components/BranchMenu';
import { ChatInput } from '@/web/components/ChatInput';
import { CompactPrompt } from '@/web/components/CompactPrompt';
import { ContextIndicator } from '@/web/components/ContextIndicator';
import { CostBadge } from '@/web/components/CostBadge';
import { StatusBar } from '@/web/components/StatusBar';
import { ExportDialog } from '@/web/components/ExportDialog';
import { McpPanel } from '@/web/components/McpPanel';
import { MessageList } from '@/web/components/MessageList';
import { ModelSelector } from '@/web/components/ModelSelector';
import { NotificationCenter } from '@/web/components/NotificationCenter';
import { PermissionBanner } from '@/web/components/PermissionBanner';
import { PlanViewer } from '@/web/components/PlanViewer';
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

  // Push notifications for background tab events
  usePushNotificationFromMessages({ sessionId, lastMessage });

  const [isStreaming, setIsStreaming] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Header menu state
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  // Export dialog state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  // Clear confirmation state
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  // Branch menu
  const branchMenu = useBranchMenu();

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
  const activeTasks: Task[] = activeSnapshot?.activeTasks ?? [];

  const isPlanMode = useMemo(
    () => activeTasks.some((t) => t.activeForm === 'plan'),
    [activeTasks],
  );

  // Close header menu when clicking outside
  useEffect(() => {
    if (!headerMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [headerMenuOpen]);

  // Batch WebSocket event processing at ~60fps (16ms) to avoid excessive re-renders
  const pendingDeltasRef = useRef<StreamDelta[]>([]);
  const batchRafRef = useRef<number>(0);

  const flushDeltas = useCallback(() => {
    batchRafRef.current = 0;
    const deltas = pendingDeltasRef.current;
    if (deltas.length === 0) return;
    pendingDeltasRef.current = [];

    setMessages((prev: Message[]) => {
      let updated = prev;
      for (const delta of deltas) {
        updated = applyDelta(updated, delta);
      }
      return updated;
    });
  }, [setMessages]);

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

    if (msg.type === 'reply') {
      const reply = msg as { type: 'reply'; cmdId: string; data: unknown };
      // Handle export reply
      if (reply.cmdId.startsWith('export-') && reply.data) {
        setExportResult(reply.data as ExportResult);
        setExportLoading(false);
      }
    }

    if (msg.type === 'event') {
      const event = msg.event as HubEvent;

      if (event.type === 'sdk:message') {
        const payload = event.payload;
        // Handle streaming deltas - batch for next animation frame
        if (payload.type === 'assistant:delta') {
          setIsStreaming(true);
          const delta = payload as unknown as { type: string; delta: StreamDelta };
          pendingDeltasRef.current.push(delta.delta);
          if (!batchRafRef.current) {
            batchRafRef.current = requestAnimationFrame(flushDeltas);
          }
        } else if (payload.type === 'assistant:done') {
          // Flush any remaining deltas immediately, then mark done
          if (pendingDeltasRef.current.length > 0) {
            cancelAnimationFrame(batchRafRef.current);
            batchRafRef.current = 0;
            flushDeltas();
          }
          setIsStreaming(false);
        } else if (payload.type === 'message:added') {
          const addedMsg = payload as unknown as { type: string; message: Message };
          // Use startTransition for non-urgent state updates (new messages)
          startTransition(() => {
            setMessages((prev: Message[]) => [...prev, addedMsg.message]);
          });
        }
      }

      // Handle MCP server status changes
      if (event.type === 'hub:mcp:statusChanged' && activeSnapshot) {
        const updatedServer = event.server;
        const updatedServers = activeSnapshot.mcpServers.map((s) =>
          s.id === updatedServer.id ? updatedServer : s,
        );
        setSnapshot({ ...activeSnapshot, mcpServers: updatedServers });
      }

      if (event.type === 'hub:chat:cleared') {
        setMessages([]);
      }

      if (event.type === 'hub:chat:compacted') {
        // Session was compacted; snapshot will follow
      }
    }
  }, [lastMessage, setMessages, setSnapshot, flushDeltas]);

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

  const handleCompact = useCallback(() => {
    sendCommand({
      cmdId: `compact-${Date.now()}`,
      cmd: 'chat:compact',
    });
    setHeaderMenuOpen(false);
  }, [sendCommand]);

  const handleConfigChange = useCallback(
    (patch: Partial<SessionConfig>) => {
      sendCommand({
        cmdId: `config-${Date.now()}`,
        cmd: 'config:set',
        patch,
      });
    },
    [sendCommand],
  );

  const handleExport = useCallback(
    (format: 'markdown' | 'json') => {
      setExportLoading(true);
      sendCommand({
        cmdId: `export-${Date.now()}`,
        cmd: 'chat:export',
        format,
      });
    },
    [sendCommand],
  );

  const handleExportOpen = useCallback(() => {
    setExportResult(null);
    setExportLoading(false);
    setExportOpen(true);
    setHeaderMenuOpen(false);
  }, []);

  const handleClear = useCallback(() => {
    sendCommand({
      cmdId: `clear-${Date.now()}`,
      cmd: 'chat:clear',
    });
    setClearConfirmOpen(false);
    setHeaderMenuOpen(false);
  }, [sendCommand]);

  const handleClearPrompt = useCallback(() => {
    setClearConfirmOpen(true);
    setHeaderMenuOpen(false);
  }, []);

  const handleBranch = useCallback(
    (messageId: string) => {
      sendCommand({
        cmdId: `branch-${Date.now()}`,
        cmd: 'chat:branch',
        messageId,
      });
    },
    [sendCommand],
  );

  const handleLoadMore = useCallback(() => {
    // Pagination: request older messages
    // This would send a history command; for now it's a no-op placeholder
    setHasMore(false);
  }, []);

  const handleExitPlanMode = useCallback(() => {
    sendCommand({
      cmdId: `plan-exit-${Date.now()}`,
      cmd: 'chat',
      text: '/plan:exit',
    });
  }, [sendCommand]);

  return (
    <main className="flex h-[100dvh] flex-col bg-gray-950">
      {/* Header */}
      <header className="shrink-0 border-b border-gray-800 px-4 py-2">
        <div className="flex items-center justify-between">
          <h1 className="truncate text-lg font-semibold text-gray-100">{session.name}</h1>
          <div className="flex items-center gap-2">
            <NotificationCenter />
            {/* Header menu button */}
            <div className="relative" ref={headerMenuRef}>
              <button
                type="button"
                onClick={() => setHeaderMenuOpen((prev) => !prev)}
                className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                title="Chat options"
              >
                &#8943;
              </button>
              {headerMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
                  <button
                    type="button"
                    onClick={handleExportOpen}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={handleCompact}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
                  >
                    Compact
                  </button>
                  <div className="mx-2 border-t border-gray-800" />
                  <button
                    type="button"
                    onClick={handleClearPrompt}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-800"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
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
            <button
              type="button"
              className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <ModelSelector config={config} options={options} onConfigChange={handleConfigChange} />
          <ContextIndicator usage={usage} modelName={config.model} />
          <CostBadge cost={cost} />
        </div>
      </header>

      {/* Plan mode viewer */}
      <div className="shrink-0">
        <PlanViewer
          tasks={activeTasks}
          messages={messages}
          onExitPlanMode={handleExitPlanMode}
        />
      </div>

      {/* Banners */}
      <div className="shrink-0 space-y-1 px-3 pt-1">
        <PermissionBanner requests={permissions} writerStatus={writerStatus} onRespond={handlePermissionRespond} />
        <CompactPrompt usage={usage} onCompact={handleCompact} />
      </div>

      {/* Message list */}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
        onMessageContextMenu={branchMenu.handleContextMenu}
        onMessageTouchStart={branchMenu.handleTouchStart}
        onMessageTouchEnd={branchMenu.handleTouchEnd}
      />

      {/* Branch context menu */}
      {branchMenu.menuState && (
        <BranchMenu
          messageId={branchMenu.menuState.messageId}
          message={branchMenu.menuState.message}
          position={branchMenu.menuState.position}
          onBranch={handleBranch}
          onClose={branchMenu.closeMenu}
        />
      )}

      {/* Export dialog */}
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onExport={handleExport}
        result={exportResult}
        loading={exportLoading}
      />

      {/* Clear confirmation dialog */}
      {clearConfirmOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setClearConfirmOpen(false); }}
        >
          <div className="mx-4 w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-gray-100">Clear conversation?</h3>
            <p className="mt-2 text-sm text-gray-400">
              This will remove all messages from the current session. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating panels / dialogs */}
      <SkillPalette skills={skills} />
      <McpPanel servers={servers} sendCommand={sendCommand} />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        options={options}
        servers={servers}
        onConfigChange={handleConfigChange}
      />

      {/* Status bar above input */}
      <StatusBar config={config} usage={usage} cost={cost} />

      {/* Input bar - fixed at bottom, with padding for the fixed element */}
      <div className="shrink-0 h-16" />
      <ChatInput
        onSend={handleSend}
        onAbort={handleAbort}
        isStreaming={isStreaming}
        disabled={!connected}
        placeholder={isPlanMode ? 'Discuss the plan...' : undefined}
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

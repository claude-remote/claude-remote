/**
 * End-to-end integration tests for the chat chain.
 *
 * These tests wire up real EventBus + SessionManager + ConnectionManager
 * with WebSocketHandler and a mocked Hub to exercise complete flows:
 *   1. Basic conversation (chat → events → reply)
 *   2. Tool call flow (chat → tool_use event → tool result → continuation)
 *   3. Abort mid-generation (chat → chat:abort → interrupted status)
 *   4. Permission request / control:respond flow
 *   5. Multi-client broadcast (writer + standby both receive events)
 *   6. Error recovery (API error → error event → new chat succeeds)
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventBus } from '@/hub/EventBus';
import type { Hub } from '@/hub/Hub';
import { SessionManager } from '@/hub/SessionManager';
import { ConnectionManager, type WebSocketLike } from '@/server/ws/ConnectionManager';
import { WebSocketHandler } from '@/server/ws/handler';
import type { WsTicketPayload, WsTicketValidator } from '@/server/ws/handler';
import type { HubResponse } from '@/shared/protocol';

// ── Helpers ────────────────────────────────────────────────────────

function createMockStore() {
  return {
    saveSession: mock(() => {}),
    getSession: mock(() => null),
    listSessions: mock(() => []),
    deleteSession: mock(() => {}),
    saveMessage: mock(() => {}),
    getMessages: mock(() => []),
  } as any;
}

function createMockWs(): WebSocketLike & {
  sentMessages: string[];
  closeCalls: Array<{ code?: number; reason?: string }>;
} {
  const ws = {
    readyState: 1,
    sentMessages: [] as string[],
    closeCalls: [] as Array<{ code?: number; reason?: string }>,
    send(msg: string) {
      ws.sentMessages.push(msg);
    },
    close(code?: number, reason?: string) {
      ws.readyState = 3;
      ws.closeCalls.push({ code, reason });
    },
  };
  return ws;
}

function createTicketValidator(sessionId: string): WsTicketValidator {
  return {
    validate: () => ({ sessionId, clientType: 'web' as const }),
  };
}

function parseSent(ws: { sentMessages: string[] }, index: number): HubResponse {
  return JSON.parse(ws.sentMessages[index]!) as HubResponse;
}

function findReply(ws: { sentMessages: string[] }, cmdId: string): HubResponse {
  for (const msg of ws.sentMessages) {
    const parsed = JSON.parse(msg) as HubResponse;
    if ((parsed.type === 'reply' || parsed.type === 'error') && (parsed as any).cmdId === cmdId) {
      return parsed;
    }
  }
  throw new Error(`no reply found for cmdId=${cmdId}`);
}

function findEvents(ws: { sentMessages: string[] }, eventType: string): any[] {
  const events: any[] = [];
  for (const msg of ws.sentMessages) {
    const parsed = JSON.parse(msg) as HubResponse;
    if (parsed.type === 'event' && (parsed as any).event?.type === eventType) {
      events.push((parsed as any).event);
    }
  }
  return events;
}

function allParsed(ws: { sentMessages: string[] }): HubResponse[] {
  return ws.sentMessages.map((m) => JSON.parse(m) as HubResponse);
}

// ── Shared state ───────────────────────────────────────────────────

let store: ReturnType<typeof createMockStore>;
let eventBus: EventBus;
let sessionManager: SessionManager;
let connectionManager: ConnectionManager;
let tempDir: string;

beforeEach(() => {
  store = createMockStore();
  eventBus = new EventBus();
  sessionManager = new SessionManager(store, eventBus);
  connectionManager = new ConnectionManager();
  tempDir = mkdtempSync(join(tmpdir(), 'e2e-chat-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Scenario helpers ───────────────────────────────────────────────

function createMockHubForChat(overrides?: {
  sendChat?: ReturnType<typeof mock>;
  abortChat?: ReturnType<typeof mock>;
  getClaudeClient?: ReturnType<typeof mock>;
}) {
  return {
    toggleMcpServer: mock(() => undefined),
    reconnectMcpServer: mock(() => undefined),
    abortChat: overrides?.abortChat ?? mock(() => Promise.resolve()),
    sendChat: overrides?.sendChat ?? mock(() => Promise.resolve({ ok: true as const })),
    getClaudeClient: overrides?.getClaudeClient ?? mock(() => ({
      compact: mock(() => Promise.resolve([])),
      summarizeCost: mock(() => ({
        sessionCost: 0,
        formattedCost: '$0.00',
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        sessionDuration: 0,
      })),
      getUsage: mock(() => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })),
    })),
    invokeSkill: mock(() => null),
    listSkills: mock(() => []),
    getSessionSkills: mock(() => []),
    listMcpServers: mock(() => []),
    getMcpServer: mock(() => undefined),
    getToolEngine: mock(() => ({
      execute: mock(() => Promise.resolve({ status: 'completed', output: 'ok' })),
    })),
  } as any;
}

interface E2EContext {
  handler: WebSocketHandler;
  ws: ReturnType<typeof createMockWs>;
  clientId: string;
  sessionId: string;
  hub: ReturnType<typeof createMockHubForChat>;
}

function setupE2E(hubOverrides?: Parameters<typeof createMockHubForChat>[0]): E2EContext {
  const hub = createMockHubForChat(hubOverrides);
  const meta = sessionManager.createSession({ cwd: tempDir, name: 'e2e-test' });

  const handler = new WebSocketHandler({
    sessionManager,
    eventBus,
    connectionManager,
    ticketValidator: createTicketValidator(meta.id),
    heartbeatIntervalMs: 999999,
    hub: hub as Hub,
  });

  const ws = createMockWs();
  const clientId = handler.handleUpgrade(ws, { ticket: 'valid' })!;
  ws.sentMessages.length = 0; // clear hello + snapshot

  return { handler, ws, clientId, sessionId: meta.id, hub };
}

function teardown(ctx: E2EContext) {
  ctx.handler.handleDisconnect(ctx.clientId);
  ctx.handler.destroy();
}

// ── Scenario 1: Basic conversation ─────────────────────────────────

describe('E2E: basic conversation', () => {
  test('chat command creates message, publishes status, and fires sendChat', async () => {
    const ctx = setupE2E();

    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-1', cmd: 'chat', text: 'Hello from e2e' }),
    );

    // Reply should contain messageId
    const reply = findReply(ctx.ws, 'e2e-1');
    expect(reply.type).toBe('reply');
    expect((reply as any).data.messageId).toBeDefined();

    // Session should have the user message
    const session = sessionManager.getSession(ctx.sessionId)!;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]!.role).toBe('user');
    expect(session.messages[0]!.content[0]).toEqual({ type: 'text', text: 'Hello from e2e' });

    // Hub.sendChat should have been called
    expect(ctx.hub.sendChat).toHaveBeenCalled();

    // Status change event should have been broadcast to the WS client
    const statusEvents = findEvents(ctx.ws, 'hub:session:statusChanged');
    expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    expect(statusEvents[0]!.status).toBe('active');

    teardown(ctx);
  });

  test('full round-trip: chat then EventBus streaming events arrive at client', async () => {
    const ctx = setupE2E({
      sendChat: mock(async () => {
        // Simulate ClaudeClient publishing streaming events
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'message_start', apiType: 'message_start' },
        } as any);
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'delta', apiType: 'content_block_delta', text: 'Hello!' },
        } as any);
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'message_stop', apiType: 'message_stop' },
        } as any);
        return { ok: true as const };
      }),
    });

    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-2', cmd: 'chat', text: 'Stream test' }),
    );

    // Wait a tick for non-blocking sendChat to complete
    await new Promise((r) => setTimeout(r, 50));

    // Should have received sdk:message events
    const sdkEvents = findEvents(ctx.ws, 'sdk:message');
    expect(sdkEvents.length).toBeGreaterThanOrEqual(3);
    expect(sdkEvents[0]!.payload.apiType).toBe('message_start');
    expect(sdkEvents[sdkEvents.length - 1]!.payload.apiType).toBe('message_stop');

    teardown(ctx);
  });
});

// ── Scenario 2: Tool call flow ─────────────────────────────────────

describe('E2E: tool call flow', () => {
  test('chat triggers sendChat which publishes tool_use events', async () => {
    const ctx = setupE2E({
      sendChat: mock(async () => {
        // Simulate tool_use content block events
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'content_block_start', apiType: 'content_block_start', content_block: { type: 'tool_use', id: 'tu-1', name: 'Read' } },
        } as any);
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'delta', apiType: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":"/tmp"}' } },
        } as any);
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'content_block_stop', apiType: 'content_block_stop' },
        } as any);
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'message_stop', apiType: 'message_stop' },
        } as any);
        return { ok: true as const };
      }),
    });

    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-tool', cmd: 'chat', text: 'Read a file' }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const sdkEvents = findEvents(ctx.ws, 'sdk:message');
    expect(sdkEvents.length).toBeGreaterThanOrEqual(4);

    // Verify tool_use content_block_start arrived
    const toolStart = sdkEvents.find(
      (e) => e.payload.apiType === 'content_block_start',
    );
    expect(toolStart).toBeDefined();
    expect(toolStart!.payload.content_block?.name).toBe('Read');

    teardown(ctx);
  });
});

// ── Scenario 3: Abort mid-generation ───────────────────────────────

describe('E2E: abort mid-generation', () => {
  test('chat:abort interrupts in-flight chat and publishes interrupted status', async () => {
    let resolveChat: (() => void) | undefined;
    const chatPromise = new Promise<{ ok: true }>((resolve) => {
      resolveChat = () => resolve({ ok: true });
    });

    const abortMock = mock(async () => {
      // When abort is called, resolve the pending chat
      resolveChat?.();
    });

    const ctx = setupE2E({
      sendChat: mock(() => chatPromise),
      abortChat: abortMock,
    });

    // Start a chat (non-blocking in handler, but hub.sendChat hangs until abort)
    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-chat', cmd: 'chat', text: 'Long running' }),
    );

    const chatReply = findReply(ctx.ws, 'e2e-chat');
    expect(chatReply.type).toBe('reply');
    ctx.ws.sentMessages.length = 0;

    // Now abort
    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-abort', cmd: 'chat:abort' }),
    );

    const abortReply = findReply(ctx.ws, 'e2e-abort');
    expect(abortReply.type).toBe('reply');
    expect((abortReply as any).data.ok).toBe(true);

    // hub.abortChat should have been called
    expect(abortMock).toHaveBeenCalled();

    // Interrupted status event should have been published
    const statusEvents = findEvents(ctx.ws, 'hub:session:statusChanged');
    const interrupted = statusEvents.find((e) => e.status === 'interrupted');
    expect(interrupted).toBeDefined();

    teardown(ctx);
  });

  test('abort is idempotent — calling it without active chat returns ok', async () => {
    const ctx = setupE2E();

    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-idle-abort', cmd: 'chat:abort' }),
    );

    const reply = findReply(ctx.ws, 'e2e-idle-abort');
    expect(reply.type).toBe('reply');
    expect((reply as any).data.ok).toBe(true);

    teardown(ctx);
  });
});

// ── Scenario 4: Permission request / control:respond ───────────────

describe('E2E: permission request and control:respond', () => {
  test('control:respond resolves pending permission and publishes event', async () => {
    const ctx = setupE2E();

    // Simulate a pending permission request
    const session = sessionManager.getSession(ctx.sessionId)!;
    session.pendingPermissions.push({
      id: 'perm-1',
      sessionId: ctx.sessionId,
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /' },
      createdAt: Date.now(),
    });

    // Collect events
    const events: any[] = [];
    eventBus.subscribe(ctx.sessionId, (e) => { events.push(e); });
    ctx.ws.sentMessages.length = 0;

    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({
        cmdId: 'e2e-respond',
        cmd: 'control:respond',
        requestId: 'perm-1',
        response: { type: 'control_response', requestId: 'perm-1', response: { approved: true } },
      }),
    );

    const reply = findReply(ctx.ws, 'e2e-respond');
    expect(reply.type).toBe('reply');
    expect((reply as any).data.ok).toBe(true);

    // Permission should have been consumed
    expect(session.pendingPermissions).toHaveLength(0);

    // sdk:control:response event should have been published
    const controlEvents = events.filter((e) => e.type === 'sdk:control:response');
    expect(controlEvents.length).toBe(1);
    expect(controlEvents[0]!.requestId).toBe('perm-1');
    expect(controlEvents[0]!.toolName).toBe('Bash');

    teardown(ctx);
  });

  test('control:respond returns error for unknown requestId', async () => {
    const ctx = setupE2E();
    ctx.ws.sentMessages.length = 0;

    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({
        cmdId: 'e2e-bad-respond',
        cmd: 'control:respond',
        requestId: 'nonexistent',
        response: { type: 'control_response', requestId: 'nonexistent', response: {} },
      }),
    );

    const reply = findReply(ctx.ws, 'e2e-bad-respond');
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('nonexistent');

    teardown(ctx);
  });
});

// ── Scenario 5: Multi-client broadcast ─────────────────────────────

describe('E2E: multi-client broadcast', () => {
  test('both writer and standby clients receive EventBus events', async () => {
    const hub = createMockHubForChat({
      sendChat: mock(async () => {
        await eventBus.publish(meta.id, {
          type: 'sdk:message',
          sessionId: meta.id,
          payload: { type: 'assistant', subtype: 'delta', apiType: 'content_block_delta', text: 'shared' },
        } as any);
        return { ok: true as const };
      }),
    });

    const meta = sessionManager.createSession({ cwd: tempDir, name: 'multi-client' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createTicketValidator(meta.id),
      heartbeatIntervalMs: 999999,
      hub: hub as Hub,
    });

    // Writer client
    const ws1 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid' })!;

    // Standby client
    const ws2 = createMockWs();
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid' })!;

    ws1.sentMessages.length = 0;
    ws2.sentMessages.length = 0;

    // Writer sends chat
    await handler.handleMessage(
      clientId1,
      JSON.stringify({ cmdId: 'e2e-multi', cmd: 'chat', text: 'Broadcast test' }),
    );

    await new Promise((r) => setTimeout(r, 50));

    // Writer should have reply + events
    const writerReply = findReply(ws1, 'e2e-multi');
    expect(writerReply.type).toBe('reply');

    const writerSdkEvents = findEvents(ws1, 'sdk:message');
    expect(writerSdkEvents.length).toBeGreaterThanOrEqual(1);

    // Standby should also have received the events (but NOT the reply)
    const standbyEvents = findEvents(ws2, 'sdk:message');
    expect(standbyEvents.length).toBeGreaterThanOrEqual(1);
    expect(standbyEvents[0]!.payload.text).toBe('shared');

    // Standby should NOT have the reply
    const standbyReplies = ws2.sentMessages
      .map((m) => JSON.parse(m) as HubResponse)
      .filter((p) => p.type === 'reply' && (p as any).cmdId === 'e2e-multi');
    expect(standbyReplies).toHaveLength(0);

    handler.handleDisconnect(clientId1);
    handler.handleDisconnect(clientId2);
    handler.destroy();
  });

  test('standby client cannot send chat (writer-only command)', async () => {
    const hub = createMockHubForChat();
    const meta = sessionManager.createSession({ cwd: tempDir, name: 'standby-block' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createTicketValidator(meta.id),
      heartbeatIntervalMs: 999999,
      hub: hub as Hub,
    });

    // Writer client
    const ws1 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid' })!;

    // Standby client
    const ws2 = createMockWs();
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid' })!;
    ws2.sentMessages.length = 0;

    await handler.handleMessage(
      clientId2,
      JSON.stringify({ cmdId: 'e2e-blocked', cmd: 'chat', text: 'Should fail' }),
    );

    const reply = parseSent(ws2, 0);
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('writer');

    handler.handleDisconnect(clientId1);
    handler.handleDisconnect(clientId2);
    handler.destroy();
  });
});

// ── Scenario 6: Error recovery ─────────────────────────────────────

describe('E2E: error recovery', () => {
  test('API error is published via EventBus, then a new chat succeeds', async () => {
    let callCount = 0;

    const ctx = setupE2E({
      sendChat: mock(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: simulate API error published via EventBus
          await eventBus.publish(ctx.sessionId, {
            type: 'sdk:message',
            sessionId: ctx.sessionId,
            payload: { type: 'error', error: 'Claude API error: 500 Internal Server Error' },
          } as any);
          return { ok: false, error: 'API error' } as any;
        }
        // Second call: succeeds
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'message_start', apiType: 'message_start' },
        } as any);
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'assistant', subtype: 'message_stop', apiType: 'message_stop' },
        } as any);
        return { ok: true as const };
      }),
    });

    // First chat — will encounter error
    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-err-1', cmd: 'chat', text: 'Fail please' }),
    );

    await new Promise((r) => setTimeout(r, 50));

    // Error event should have arrived
    const errorEvents = findEvents(ctx.ws, 'sdk:message').filter(
      (e) => e.payload.type === 'error',
    );
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0]!.payload.error).toContain('500');

    ctx.ws.sentMessages.length = 0;

    // Second chat — should succeed normally
    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-err-2', cmd: 'chat', text: 'Retry' }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const reply = findReply(ctx.ws, 'e2e-err-2');
    expect(reply.type).toBe('reply');
    expect((reply as any).data.messageId).toBeDefined();

    // Streaming events from the successful call
    const successEvents = findEvents(ctx.ws, 'sdk:message').filter(
      (e) => e.payload.apiType === 'message_stop',
    );
    expect(successEvents.length).toBeGreaterThanOrEqual(1);

    // Session should have both user messages
    const session = sessionManager.getSession(ctx.sessionId)!;
    const userMessages = session.messages.filter((m) => m.role === 'user');
    expect(userMessages.length).toBe(2);

    teardown(ctx);
  });

  test('chat:clear after error resets state for fresh conversation', async () => {
    const ctx = setupE2E({
      sendChat: mock(async () => {
        await eventBus.publish(ctx.sessionId, {
          type: 'sdk:message',
          sessionId: ctx.sessionId,
          payload: { type: 'error', error: 'rate limited' },
        } as any);
        return { ok: false, error: 'rate limited' } as any;
      }),
    });

    // Send chat that fails
    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-pre-clear', cmd: 'chat', text: 'Fail' }),
    );

    await new Promise((r) => setTimeout(r, 50));

    // Session has the message
    expect(sessionManager.getSession(ctx.sessionId)!.messages.length).toBe(1);

    ctx.ws.sentMessages.length = 0;

    // Clear the chat
    await ctx.handler.handleMessage(
      ctx.clientId,
      JSON.stringify({ cmdId: 'e2e-clear', cmd: 'chat:clear' }),
    );

    const clearReply = findReply(ctx.ws, 'e2e-clear');
    expect(clearReply.type).toBe('reply');
    expect((clearReply as any).data.ok).toBe(true);

    // Session messages should be empty
    expect(sessionManager.getSession(ctx.sessionId)!.messages).toHaveLength(0);

    // chat:cleared event should be broadcast
    const clearedEvents = findEvents(ctx.ws, 'hub:chat:cleared');
    expect(clearedEvents.length).toBe(1);

    teardown(ctx);
  });
});

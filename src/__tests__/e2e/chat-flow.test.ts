import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@/hub/EventBus';
import type { Hub } from '@/hub/Hub';
import { SessionManager } from '@/hub/SessionManager';
import { ConnectionManager, type WebSocketLike } from '@/server/ws/ConnectionManager';
import { WebSocketHandler } from '@/server/ws/handler';
import type { WsTicketPayload, WsTicketValidator } from '@/server/ws/handler';
import type { HubEvent, HubResponse } from '@/shared/protocol';

// ── Mock helpers ────────────────────────────────────────────────────

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

function createValidTicketValidator(
  payload?: Partial<WsTicketPayload>,
): WsTicketValidator {
  return {
    validate: (_ticket: string) => ({
      sessionId: 'sess-1',
      clientType: 'web' as const,
      ...payload,
    }),
  };
}

function parseSent(ws: { sentMessages: string[] }, index: number): HubResponse {
  return JSON.parse(ws.sentMessages[index]!) as HubResponse;
}

function findReply(
  ws: { sentMessages: string[] },
  cmdId?: string,
): HubResponse {
  for (const msg of ws.sentMessages) {
    const parsed = JSON.parse(msg) as HubResponse;
    if (parsed.type === 'reply' || parsed.type === 'error') {
      if (!cmdId || (parsed as any).cmdId === cmdId) {
        return parsed;
      }
    }
  }
  throw new Error(`no reply found${cmdId ? ` for cmdId=${cmdId}` : ''}`);
}

function collectEvents(eventBus: EventBus, sessionId: string): HubEvent[] {
  const events: HubEvent[] = [];
  eventBus.subscribe(sessionId, (event) => {
    events.push(event);
  });
  return events;
}

function createMockHub(overrides?: Partial<{
  sendChat: ReturnType<typeof mock>;
  abortChat: ReturnType<typeof mock>;
  toggleMcpServer: ReturnType<typeof mock>;
  reconnectMcpServer: ReturnType<typeof mock>;
  invokeSkill: ReturnType<typeof mock>;
  getClaudeClient: ReturnType<typeof mock>;
}>): Hub {
  return {
    sendChat: overrides?.sendChat ?? mock(() => Promise.resolve({ ok: true as const })),
    abortChat: overrides?.abortChat ?? mock(() => Promise.resolve()),
    toggleMcpServer: overrides?.toggleMcpServer ?? mock(() => undefined),
    reconnectMcpServer: overrides?.reconnectMcpServer ?? mock(() => undefined),
    invokeSkill: overrides?.invokeSkill ?? mock(() => null),
    getClaudeClient: overrides?.getClaudeClient ?? mock(() => ({})),
  } as any;
}

// ── Test setup ──────────────────────────────────────────────────────

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

// ── Helper: set up a connected handler + ws ─────────────────────────

function setupHandler(hub?: Hub) {
  const meta = sessionManager.createSession({ cwd: tempDir });

  const handler = new WebSocketHandler({
    sessionManager,
    eventBus,
    connectionManager,
    ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
    hub,
    heartbeatIntervalMs: 999999,
  });

  const ws = createMockWs();
  const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

  return { handler, ws, clientId: clientId!, meta };
}

// ── E2E: Chat Flow Integration Tests ────────────────────────────────

describe('E2E: chat flow integration', () => {
  // ── 1. Basic conversation ──────────────────────────────────────────

  test('basic conversation: chat returns messageId and calls hub.sendChat', async () => {
    const sendChatMock = mock(() => Promise.resolve({ ok: true as const }));
    const hub = createMockHub({ sendChat: sendChatMock });
    const { handler, ws, clientId, meta } = setupHandler(hub);
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'hello' }),
    );

    // Reply contains messageId
    const reply = findReply(ws, 'c1');
    expect(reply.type).toBe('reply');
    expect((reply as any).data.messageId).toBeDefined();
    expect(typeof (reply as any).data.messageId).toBe('string');

    // Session has user message appended
    const session = sessionManager.getSession(meta.id)!;
    expect(session.messages.length).toBeGreaterThanOrEqual(1);
    const userMsg = session.messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content[0]).toMatchObject({ type: 'text', text: 'hello' });

    // hub.sendChat was called
    // sendChat is fire-and-forget in handler, so give it a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(sendChatMock).toHaveBeenCalled();

    handler.handleDisconnect(clientId);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 2. Tool call flow ─────────────────────────────────────────────

  test('tool call flow: sdk:message events are forwarded to client', async () => {
    const sendChatMock = mock(async (sessionId: string, _text: string) => {
      // Simulate Claude responding with a tool_use via EventBus
      await eventBus.publish(sessionId, {
        type: 'sdk:message',
        sessionId,
        payload: {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'read_file',
                input: { path: '/tmp/test.txt' },
              },
            ],
          },
        },
      } as any);
      return { ok: true as const };
    });

    const hub = createMockHub({ sendChat: sendChatMock });
    const { handler, ws, clientId, meta } = setupHandler(hub);
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'read test.txt' }),
    );

    // Wait for the background sendChat to fire
    await new Promise((r) => setTimeout(r, 50));

    // Find sdk:message event in sent messages
    const sdkEvents = ws.sentMessages
      .map((m) => JSON.parse(m) as HubResponse)
      .filter((m) => m.type === 'event' && (m as any).event?.type === 'sdk:message');

    expect(sdkEvents.length).toBeGreaterThanOrEqual(1);
    const event = (sdkEvents[0] as any).event;
    expect(event.payload.message.content[0].name).toBe('read_file');

    handler.handleDisconnect(clientId);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 3. Abort generation ───────────────────────────────────────────

  test('abort generation: chat:abort calls hub.abortChat and publishes interrupted status', async () => {
    const abortChatMock = mock(() => Promise.resolve());
    const sendChatMock = mock(() =>
      // Simulate a long-running chat that never resolves
      new Promise<{ ok: true }>(() => {}),
    );
    const hub = createMockHub({ sendChat: sendChatMock, abortChat: abortChatMock });
    const { handler, ws, clientId, meta } = setupHandler(hub);

    const events = collectEvents(eventBus, meta.id);
    ws.sentMessages.length = 0;

    // Send chat first
    await handler.handleMessage(
      clientId,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'write a long essay' }),
    );

    // Then abort
    await handler.handleMessage(
      clientId,
      JSON.stringify({ cmdId: 'c2', cmd: 'chat:abort' }),
    );

    // hub.abortChat was called
    expect(abortChatMock).toHaveBeenCalled();

    // Reply to abort is success
    const abortReply = findReply(ws, 'c2');
    expect(abortReply.type).toBe('reply');
    expect((abortReply as any).data).toEqual({ ok: true });

    // Check for interrupted status event
    const statusEvents = events.filter(
      (e) => e.type === 'hub:session:statusChanged',
    );
    const interrupted = statusEvents.find(
      (e) => (e as any).status === 'interrupted',
    );
    expect(interrupted).toBeDefined();

    handler.handleDisconnect(clientId);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 4. Permission request ─────────────────────────────────────────

  test('permission request: control:respond removes pending permission and publishes event', async () => {
    const hub = createMockHub();
    const { handler, ws, clientId, meta } = setupHandler(hub);

    // Inject a pending permission into the session
    const session = sessionManager.getSession(meta.id)!;
    session.pendingPermissions.push({
      id: 'perm-1',
      sessionId: meta.id,
      toolName: 'bash',
      toolInput: { command: 'rm -rf /tmp/test' },
      createdAt: Date.now(),
    });

    const events = collectEvents(eventBus, meta.id);
    ws.sentMessages.length = 0;

    // Send control:respond
    await handler.handleMessage(
      clientId,
      JSON.stringify({
        cmdId: 'cr1',
        cmd: 'control:respond',
        requestId: 'perm-1',
        response: {
          type: 'control_response',
          requestId: 'perm-1',
          response: { decision: 'allow' },
        },
      }),
    );

    // Reply is success
    const reply = findReply(ws, 'cr1');
    expect(reply.type).toBe('reply');
    expect((reply as any).data).toEqual({ ok: true });

    // Permission removed from pending
    expect(session.pendingPermissions.length).toBe(0);

    // sdk:control:response event published
    const controlEvents = events.filter(
      (e) => e.type === 'sdk:control:response',
    );
    expect(controlEvents.length).toBeGreaterThanOrEqual(1);
    expect((controlEvents[0] as any).requestId).toBe('perm-1');

    handler.handleDisconnect(clientId);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 5. Multi-client ───────────────────────────────────────────────

  test('multi-client: standby client receives events from writer chat', async () => {
    const sendChatMock = mock(async (sessionId: string) => {
      await eventBus.publish(sessionId, {
        type: 'sdk:message',
        sessionId,
        payload: {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from Claude' }],
          },
        },
      } as any);
      return { ok: true as const };
    });

    const hub = createMockHub({ sendChat: sendChatMock });
    const meta = sessionManager.createSession({ cwd: tempDir });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      hub,
      heartbeatIntervalMs: 999999,
    });

    // Writer connects
    const ws1 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid1' })!;

    // Standby connects
    const ws2 = createMockWs();
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid2' })!;

    ws1.sentMessages.length = 0;
    ws2.sentMessages.length = 0;

    // Writer sends chat
    await handler.handleMessage(
      clientId1,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'hello' }),
    );

    // Wait for background sendChat
    await new Promise((r) => setTimeout(r, 50));

    // Standby should have received the sdk:message event
    const standbyEvents = ws2.sentMessages
      .map((m) => JSON.parse(m) as HubResponse)
      .filter((m) => m.type === 'event' && (m as any).event?.type === 'sdk:message');

    expect(standbyEvents.length).toBeGreaterThanOrEqual(1);

    handler.handleDisconnect(clientId1);
    handler.handleDisconnect(clientId2);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 6. Error recovery ─────────────────────────────────────────────

  test('error recovery: sendChat failure does not crash the session', async () => {
    const sendChatMock = mock(() =>
      Promise.reject(new Error('API rate limit exceeded')),
    );
    const hub = createMockHub({ sendChat: sendChatMock });
    const { handler, ws, clientId, meta } = setupHandler(hub);
    ws.sentMessages.length = 0;

    // Send chat — sendChat is fire-and-forget so the reply is still ok
    await handler.handleMessage(
      clientId,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'hello' }),
    );

    const reply = findReply(ws, 'c1');
    expect(reply.type).toBe('reply');
    expect((reply as any).data.messageId).toBeDefined();

    // Wait for the rejected promise to settle
    await new Promise((r) => setTimeout(r, 50));

    // Session should still be accessible (not crashed)
    const session = sessionManager.getSession(meta.id);
    expect(session).not.toBeNull();
    expect(session!.status).not.toBe('archived');

    // Can still send another command — session is still functional
    ws.sentMessages.length = 0;
    await handler.handleMessage(
      clientId,
      JSON.stringify({ cmdId: 'c2', cmd: 'cost:get' }),
    );

    const costReply = findReply(ws, 'c2');
    expect(costReply.type).toBe('reply');

    handler.handleDisconnect(clientId);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

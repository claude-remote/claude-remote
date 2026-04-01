import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { WebSocketHandler } from '@/server/ws/handler';
import type { WsTicketValidator, WsTicketPayload } from '@/server/ws/handler';
import { ConnectionManager, type WebSocketLike } from '@/server/ws/ConnectionManager';
import { EventBus } from '@/hub/EventBus';
import { SessionManager } from '@/hub/SessionManager';
import type { HubResponse } from '@/shared/protocol';

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
    readyState: 1, // OPEN
    sentMessages: [] as string[],
    closeCalls: [] as Array<{ code?: number; reason?: string }>,
    send(msg: string) {
      ws.sentMessages.push(msg);
    },
    close(code?: number, reason?: string) {
      ws.readyState = 3; // CLOSED
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

function createInvalidTicketValidator(): WsTicketValidator {
  return {
    validate: () => null,
  };
}

function parseSent(ws: { sentMessages: string[] }, index: number): HubResponse {
  return JSON.parse(ws.sentMessages[index]!) as HubResponse;
}

// ── Test setup ──────────────────────────────────────────────────────

let store: ReturnType<typeof createMockStore>;
let eventBus: EventBus;
let sessionManager: SessionManager;
let connectionManager: ConnectionManager;

beforeEach(() => {
  store = createMockStore();
  eventBus = new EventBus();
  sessionManager = new SessionManager(store, eventBus);
  connectionManager = new ConnectionManager();
});

// ── Connection tests ────────────────────────────────────────────────

describe('WebSocketHandler connection', () => {
  test('rejects connection with invalid ticket', () => {
    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createInvalidTicketValidator(),
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, {
      ticket: 'bad-ticket',
    });

    expect(clientId).toBeNull();
    expect(ws.closeCalls.length).toBe(1);
    expect(ws.closeCalls[0]!.code).toBe(4001);
  });

  test('rejects connection when session does not exist', () => {
    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({
        sessionId: 'nonexistent',
      }),
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, {
      ticket: 'valid',
    });

    expect(clientId).toBeNull();
    expect(ws.closeCalls.length).toBe(1);
    expect(ws.closeCalls[0]!.code).toBe(4004);
  });

  test('sends hello and snapshot on valid connection', () => {
    // Create a session first
    const meta = sessionManager.createSession({ cwd: '/tmp', name: 'test' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({
        sessionId: meta.id,
      }),
      heartbeatIntervalMs: 999999, // disable for this test
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    expect(clientId).not.toBeNull();

    // Should have sent hello first, then snapshot, then client:joined event
    expect(ws.sentMessages.length).toBeGreaterThanOrEqual(2);

    const hello = parseSent(ws, 0);
    expect(hello.type).toBe('hello');
    expect((hello as any).version).toBe(1);

    const snapshot = parseSent(ws, 1);
    expect(snapshot.type).toBe('snapshot');
    expect((snapshot as any).snapshot.meta.id).toBe(meta.id);

    // Clean up
    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('first connection becomes active writer', () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    const conn = connectionManager.getByClientId(clientId!);
    expect(conn).not.toBeNull();
    expect(conn!.role).toBe('active');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('second connection becomes standby', () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid1' });
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid2' });

    expect(connectionManager.getByClientId(clientId1!)!.role).toBe('active');
    expect(connectionManager.getByClientId(clientId2!)!.role).toBe('standby');

    handler.handleDisconnect(clientId1!);
    handler.handleDisconnect(clientId2!);
    handler.destroy();
  });
});

// ── Command routing tests ───────────────────────────────────────────

describe('WebSocketHandler command routing', () => {
  test('routes session:list command', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0; // clear hello + snapshot

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'session:list' }),
    );

    expect(ws.sentMessages.length).toBe(1);
    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).cmdId).toBe('c1');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('rejects invalid command format', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(clientId!, 'not-json{');

    expect(ws.sentMessages.length).toBe(1);
    const error = parseSent(ws, 0);
    expect(error.type).toBe('error');
    expect((error as any).error).toContain('invalid command');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('rejects writer-only command from standby', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    // First connection is writer
    const ws1 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid1' });

    // Second connection is standby
    const ws2 = createMockWs();
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid2' });
    ws2.sentMessages.length = 0;

    // Standby tries to send chat
    await handler.handleMessage(
      clientId2!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'hello' }),
    );

    expect(ws2.sentMessages.length).toBe(1);
    const error = parseSent(ws2, 0);
    expect(error.type).toBe('error');
    expect((error as any).error).toContain('requires active writer');

    handler.handleDisconnect(clientId1!);
    handler.handleDisconnect(clientId2!);
    handler.destroy();
  });

  test('allows standby to execute read-only commands', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws1 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid1' });

    const ws2 = createMockWs();
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid2' });
    ws2.sentMessages.length = 0;

    await handler.handleMessage(
      clientId2!,
      JSON.stringify({ cmdId: 'c1', cmd: 'cost:get' }),
    );

    const reply = parseSent(ws2, 0);
    expect(reply.type).toBe('reply');

    handler.handleDisconnect(clientId1!);
    handler.handleDisconnect(clientId2!);
    handler.destroy();
  });
});

// ── Heartbeat tests ─────────────────────────────────────────────────

describe('WebSocketHandler heartbeat', () => {
  test('sends ping after interval', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 50,
      heartbeatTimeoutMs: 5000,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    const initialCount = ws.sentMessages.length;

    // Wait for heartbeat ping
    await new Promise((r) => setTimeout(r, 100));

    // Should have received at least one ping
    const newMessages = ws.sentMessages.slice(initialCount);
    const pings = newMessages.filter((m) => {
      try {
        return JSON.parse(m).type === 'ping';
      } catch {
        return false;
      }
    });
    expect(pings.length).toBeGreaterThan(0);

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('disconnects on heartbeat timeout', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 30,
      heartbeatTimeoutMs: 30,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    // Wait for heartbeat + timeout
    await new Promise((r) => setTimeout(r, 150));

    // Connection should be closed or removed
    expect(ws.closeCalls.length).toBeGreaterThan(0);
    const closeCall = ws.closeCalls.find((c) => c.code === 4008);
    expect(closeCall).toBeDefined();

    handler.destroy();
  });

  test('pong resets heartbeat timeout', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 50,
      heartbeatTimeoutMs: 80,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    // Respond to pong before timeout
    await new Promise((r) => setTimeout(r, 60));
    handler.handlePong(clientId!);

    // Wait a bit more — should not have disconnected
    await new Promise((r) => setTimeout(r, 40));
    expect(ws.closeCalls.length).toBe(0);

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });
});

// ── Disconnect tests ────────────────────────────────────────────────

describe('WebSocketHandler disconnect', () => {
  test('auto-promotes standby to writer on disconnect', () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid1' });
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid2' });

    expect(connectionManager.getByClientId(clientId2!)!.role).toBe('standby');

    // Disconnect writer
    handler.handleDisconnect(clientId1!);

    // Standby should be promoted
    expect(connectionManager.getByClientId(clientId2!)!.role).toBe('active');

    handler.handleDisconnect(clientId2!);
    handler.destroy();
  });

  test('unsubscribes from EventBus on disconnect', () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    const msgCountBefore = ws.sentMessages.length;

    handler.handleDisconnect(clientId!);

    // Publishing after disconnect should not send to the disconnected ws
    eventBus.publish(meta.id, {
      type: 'hub:session:statusChanged',
      sessionId: meta.id,
      status: 'idle',
    });

    // No new messages after disconnect
    expect(ws.sentMessages.length).toBe(msgCountBefore);

    handler.destroy();
  });
});

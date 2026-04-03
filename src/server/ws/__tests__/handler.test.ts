import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@/hub/EventBus';
import type { Hub } from '@/hub/Hub';
import { SessionManager } from '@/hub/SessionManager';
import { ConnectionManager, type WebSocketLike } from '@/server/ws/ConnectionManager';
import { WebSocketHandler } from '@/server/ws/handler';
import type { WsTicketPayload, WsTicketValidator } from '@/server/ws/handler';
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

function createValidTicketValidator(payload?: Partial<WsTicketPayload>): WsTicketValidator {
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

function createMockHub(overrides?: {
  toggleMcpServer?: ReturnType<typeof mock>;
  reconnectMcpServer?: ReturnType<typeof mock>;
  abortChat?: ReturnType<typeof mock>;
}): Pick<Hub, 'toggleMcpServer' | 'reconnectMcpServer' | 'abortChat'> {
  return {
    toggleMcpServer: overrides?.toggleMcpServer ?? mock(() => undefined),
    reconnectMcpServer: overrides?.reconnectMcpServer ?? mock(() => undefined),
    abortChat: overrides?.abortChat ?? mock(() => Promise.resolve()),
  };
}

function parseSent(ws: { sentMessages: string[] }, index: number): HubResponse {
  return JSON.parse(ws.sentMessages[index]!) as HubResponse;
}

function findReply(ws: { sentMessages: string[] }, cmdId?: string): HubResponse {
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
    expect(ws.closeCalls[0]?.code).toBe(4001);
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
    expect(ws.closeCalls[0]?.code).toBe(4004);
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
    expect(conn?.role).toBe('active');

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

    expect(connectionManager.getByClientId(clientId1!)?.role).toBe('active');
    expect(connectionManager.getByClientId(clientId2!)?.role).toBe('standby');

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

    await handler.handleMessage(clientId!, JSON.stringify({ cmdId: 'c1', cmd: 'session:list' }));

    expect(ws.sentMessages.length).toBe(1);
    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).cmdId).toBe('c1');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('routes file:list command', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-haha-ws-list-'));
    mkdirSync(join(tempDir, 'nested'));
    writeFileSync(join(tempDir, 'example.txt'), 'hello\n');
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    try {
      await handler.handleMessage(
        clientId!,
        JSON.stringify({ cmdId: 'c1', cmd: 'file:list', path: tempDir }),
      );

      expect(ws.sentMessages.length).toBe(1);
      const reply = parseSent(ws, 0);
      expect(reply.type).toBe('reply');
      expect((reply as any).cmdId).toBe('c1');
      expect((reply as any).data.path).toBe(tempDir);
      expect(Array.isArray((reply as any).data.entries)).toBe(true);
    } finally {
      handler.handleDisconnect(clientId!);
      handler.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns error for file:list outside session cwd', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-haha-ws-list-root-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    try {
      await handler.handleMessage(
        clientId!,
        JSON.stringify({ cmdId: 'c1', cmd: 'file:list', path: '/etc' }),
      );

      expect(ws.sentMessages.length).toBe(1);
      const error = parseSent(ws, 0);
      expect(error).toEqual({
        type: 'error',
        cmdId: 'c1',
        error: 'path not allowed: outside session working directory',
      });
    } finally {
      handler.handleDisconnect(clientId!);
      handler.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns error for file:list on missing path', async () => {
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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'file:list', path: '/tmp/claude-code-haha-does-not-exist' }),
    );

    expect(ws.sentMessages.length).toBe(1);
    const error = parseSent(ws, 0);
    expect(error.type).toBe('error');
    expect((error as any).cmdId).toBe('c1');
    expect(typeof (error as any).error).toBe('string');
    expect((error as any).error.length).toBeGreaterThan(0);

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('reads file content with pagination for file:read', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-haha-ws-read-'));
    const filePath = join(tempDir, 'example.txt');
    writeFileSync(filePath, 'line 1\nline 2\nline 3\nline 4\n');
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'file:read',
        path: filePath,
        offset: 1,
        limit: 2,
      }),
    );

    expect(ws.sentMessages.length).toBe(1);
    const reply = parseSent(ws, 0);
    expect(reply).toMatchObject({
      type: 'reply',
      cmdId: 'c1',
      data: {
        path: filePath,
        content: 'line 2\nline 3',
        totalLines: 5,
        offset: 1,
        limit: 2,
        size: 28,
      },
    });
    expect(typeof (reply as any).data.modified).toBe('string');
    expect(new Date((reply as any).data.modified).toISOString()).toBe((reply as any).data.modified);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns an error when file:read path does not exist', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-haha-ws-read-missing-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    try {
      await handler.handleMessage(
        clientId!,
        JSON.stringify({
          cmdId: 'c1',
          cmd: 'file:read',
          path: join(tempDir, 'claude-code-haha-file-read-does-not-exist'),
        }),
      );

      expect(ws.sentMessages.length).toBe(1);
      const error = parseSent(ws, 0);
      expect(error.type).toBe('error');
      expect((error as any).cmdId).toBe('c1');
      expect(typeof (error as any).error).toBe('string');
      expect((error as any).error.length).toBeGreaterThan(0);
    } finally {
      handler.handleDisconnect(clientId!);
      handler.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns error for file:read path traversal outside session cwd', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-haha-ws-read-root-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    try {
      await handler.handleMessage(
        clientId!,
        JSON.stringify({
          cmdId: 'c1',
          cmd: 'file:read',
          path: '../../etc/passwd',
        }),
      );

      expect(ws.sentMessages.length).toBe(1);
      const error = parseSent(ws, 0);
      expect(error).toEqual({
        type: 'error',
        cmdId: 'c1',
        error: 'path not allowed: outside session working directory',
      });
    } finally {
      handler.handleDisconnect(clientId!);
      handler.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns an error when file:read exceeds the size limit', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-haha-ws-read-limit-'));
    const filePath = join(tempDir, 'oversized.txt');
    writeFileSync(filePath, Buffer.alloc(10 * 1024 * 1024 + 1, 'a'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'file:read',
        path: filePath,
      }),
    );

    try {
      expect(ws.sentMessages.length).toBe(1);
      const error = parseSent(ws, 0);
      expect(error.type).toBe('error');
      expect((error as any).cmdId).toBe('c1');
      expect((error as any).error).toContain('10MB');
    } finally {
      handler.handleDisconnect(clientId!);
      handler.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
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

    await handler.handleMessage(clientId2!, JSON.stringify({ cmdId: 'c1', cmd: 'cost:get' }));

    const reply = parseSent(ws2, 0);
    expect(reply.type).toBe('reply');

    handler.handleDisconnect(clientId1!);
    handler.handleDisconnect(clientId2!);
    handler.destroy();
  });

  test('returns session config for config:get', async () => {
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

    await handler.handleMessage(clientId!, JSON.stringify({ cmdId: 'c1', cmd: 'config:get' }));

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).data.config.model).toBeDefined();
    expect(Array.isArray((reply as any).data.options.effortLevels)).toBe(true);

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('updates session config for config:set', async () => {
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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'config:set',
        patch: { model: 'claude-3-opus' },
      }),
    );

    const messages = ws.sentMessages.map((message) => JSON.parse(message) as HubResponse);
    const reply = messages.find(
      (message): message is Extract<HubResponse, { type: 'reply' }> => message.type === 'reply',
    );

    expect(reply).toBeDefined();
    expect(reply?.cmdId).toBe('c1');
    expect((reply?.data as any).ok).toBe(true);
    expect((reply?.data as any).sessionId).toBe(meta.id);
    expect((reply?.data as any).updated.model).toBe('claude-3-opus');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('returns available skills for skill:list', async () => {
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

    await handler.handleMessage(clientId!, JSON.stringify({ cmdId: 'c1', cmd: 'skill:list' }));

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect(Array.isArray((reply as any).data.skills)).toBe(true);
    expect((reply as any).data.skills.length).toBeGreaterThan(0);

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('routes mcp:toggle through hub and returns updated server', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });
    const server = {
      id: 'server-1',
      name: 'Server 1',
      type: 'stdio' as const,
      status: 'disconnected' as const,
      enabled: false,
      toolCount: 2,
    };
    const hub = createMockHub({
      toggleMcpServer: mock(() => ({ ...server, enabled: true, status: 'connected' as const })),
    });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: hub as Hub,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'mcp:toggle',
        serverId: 'server-1',
        enabled: true,
      }),
    );

    expect(hub.toggleMcpServer).toHaveBeenCalledWith('server-1', true);
    const reply = parseSent(ws, 0);
    expect(reply).toMatchObject({
      type: 'reply',
      cmdId: 'c1',
      data: {
        id: 'server-1',
        enabled: true,
        status: 'connected',
      },
    });

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('routes mcp:reconnect through hub and returns updated server', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });
    const server = {
      id: 'server-1',
      name: 'Server 1',
      type: 'stdio' as const,
      status: 'error' as const,
      enabled: true,
      toolCount: 2,
      error: 'boom',
    };
    const hub = createMockHub({
      reconnectMcpServer: mock(() => ({
        ...server,
        status: 'connected' as const,
        error: undefined,
      })),
    });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: hub as Hub,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'mcp:reconnect',
        serverId: 'server-1',
      }),
    );

    expect(hub.reconnectMcpServer).toHaveBeenCalledWith('server-1');
    const reply = parseSent(ws, 0);
    expect(reply).toMatchObject({
      type: 'reply',
      cmdId: 'c1',
      data: {
        id: 'server-1',
        status: 'connected',
      },
    });

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('returns error for MCP commands when hub is missing', async () => {
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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'mcp:toggle',
        serverId: 'server-1',
        enabled: true,
      }),
    );

    const error = parseSent(ws, 0);
    expect(error).toMatchObject({
      type: 'error',
      cmdId: 'c1',
    });
    expect((error as any).error).toContain('hub');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('returns error for MCP commands when server is not found', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });
    const hub = createMockHub({
      toggleMcpServer: mock(() => undefined),
    });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: hub as Hub,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'mcp:toggle',
        serverId: 'missing-server',
        enabled: false,
      }),
    );

    expect(hub.toggleMcpServer).toHaveBeenCalledWith('missing-server', false);
    const error = parseSent(ws, 0);
    expect(error).toMatchObject({
      type: 'error',
      cmdId: 'c1',
    });
    expect((error as any).error).toContain('missing-server');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('returns context usage for context:usage', async () => {
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

    await handler.handleMessage(clientId!, JSON.stringify({ cmdId: 'c1', cmd: 'context:usage' }));

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect(typeof (reply as any).data.usedTokens).toBe('number');
    expect(typeof (reply as any).data.maxTokens).toBe('number');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('returns cost summary for cost:get', async () => {
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

    await handler.handleMessage(clientId!, JSON.stringify({ cmdId: 'c1', cmd: 'cost:get' }));

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect(typeof (reply as any).data.sessionCost).toBe('number');
    expect(typeof (reply as any).data.formattedCost).toBe('string');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('returns matching messages for history:search', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp' });
    const session = sessionManager.getSession(meta.id)!;
    session.messages.push(
      {
        id: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: 'hello websocket history' }],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: [{ type: 'text', text: 'different text' }],
        createdAt: 2,
        updatedAt: 2,
      },
    );

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'history:search', query: 'hello', scope: 'session' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect(Array.isArray((reply as any).data.results)).toBe(true);
    expect((reply as any).data.results).toHaveLength(1);
    expect((reply as any).data.results[0].messageId).toBe('msg-1');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('exports session messages as markdown for chat:export', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp/project', name: 'Export Session' });
    const session = sessionManager.getSession(meta.id)!;
    session.messages.push(
      {
        id: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello from user' }],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from assistant' }],
        createdAt: 2,
        updatedAt: 2,
      },
    );

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat:export', format: 'markdown' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).data.sessionId).toBe(meta.id);
    expect((reply as any).data.format).toBe('markdown');
    expect((reply as any).data.filename).toBe(`session-${meta.id}.md`);
    expect((reply as any).data.content).toContain('# Export Session');
    expect((reply as any).data.content).toContain('Hello from user');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('exports session messages as json for chat:export', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp/project', name: 'Export Session' });
    const session = sessionManager.getSession(meta.id)!;
    session.messages.push({
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: 'Hello from user' }],
      createdAt: 1,
      updatedAt: 1,
    });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat:export', format: 'json' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).data.sessionId).toBe(meta.id);
    expect((reply as any).data.format).toBe('json');
    expect((reply as any).data.filename).toBe(`session-${meta.id}.json`);
    expect(JSON.parse((reply as any).data.content)).toMatchObject({
      id: meta.id,
      name: 'Export Session',
    });

    handler.handleDisconnect(clientId!);
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

    expect(connectionManager.getByClientId(clientId2!)?.role).toBe('standby');

    // Disconnect writer
    handler.handleDisconnect(clientId1!);

    // Standby should be promoted
    expect(connectionManager.getByClientId(clientId2!)?.role).toBe('active');

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
    } as any);

    // No new messages after disconnect
    expect(ws.sentMessages.length).toBe(msgCountBefore);

    handler.destroy();
  });
});

describe('WebSocketHandler missing session handling', () => {
  test('returns an error for config:set when the session does not exist', async () => {
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

    ((sessionManager as any).sessions as Map<string, unknown>).delete(meta.id);
    ((sessionManager as any).sessionConfigs as Map<string, unknown>).delete(meta.id);

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'config:set',
        patch: { model: 'claude-3-opus' },
      }),
    );

    expect(ws.sentMessages.length).toBe(1);
    const error = parseSent(ws, 0);
    expect(error.type).toBe('error');
    expect((error as any).cmdId).toBe('c1');
    expect((error as any).error).toContain(`session not found: ${meta.id}`);

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('returns an error for chat:export when the session does not exist', async () => {
    const meta = sessionManager.createSession({ cwd: '/tmp/project', name: 'Export Session' });

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

    ((sessionManager as any).sessions as Map<string, unknown>).delete(meta.id);
    ((sessionManager as any).sessionConfigs as Map<string, unknown>).delete(meta.id);

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat:export', format: 'markdown' }),
    );

    expect(ws.sentMessages.length).toBe(1);
    const error = parseSent(ws, 0);
    expect(error.type).toBe('error');
    expect((error as any).cmdId).toBe('c1');
    expect((error as any).error).toBe('Session not found');

    handler.handleDisconnect(clientId!);
    handler.destroy();
  });

  test('uses default offset and limit for file:read when they are omitted', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-haha-ws-read-defaults-'));
    const filePath = join(tempDir, 'example.txt');
    writeFileSync(filePath, Array.from({ length: 205 }, (_, index) => `line ${index + 1}`).join('\n'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'c1',
        cmd: 'file:read',
        path: filePath,
      }),
    );

    expect(ws.sentMessages.length).toBe(1);
    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).cmdId).toBe('c1');
    expect((reply as any).data.offset).toBe(0);
    expect((reply as any).data.limit).toBe(200);
    expect((reply as any).data.totalLines).toBe(205);
    expect((reply as any).data.content).toBe(
      Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join('\n'),
    );

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── cwd commands ─────────────────────────────────────────────────────

describe('WebSocketHandler cwd commands', () => {
  test('cwd:change updates session cwd', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-cwd-'));
    const subDir = join(tempDir, 'sub');
    mkdirSync(subDir);
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'cwd:change', path: subDir }),
    );

    // The EventBus may emit a cwdChanged event before the reply, so find the reply
    const reply = ws.sentMessages
      .map((m) => JSON.parse(m) as HubResponse)
      .find((r) => r.type === 'reply' && (r as any).cmdId === 'c1');
    expect(reply).toBeDefined();
    expect(reply!.type).toBe('reply');
    expect((reply as any).data.cwd).toBe(subDir);

    // Verify session cwd was actually updated
    const session = sessionManager.getSession(meta.id);
    expect(session?.cwd).toBe(subDir);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('cwd:change to nonexistent directory returns error', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-cwd-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'cwd:change', path: '/nonexistent/path' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('not accessible');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('cwd:browse returns subdirectories', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-browse-'));
    mkdirSync(join(tempDir, 'alpha'));
    mkdirSync(join(tempDir, 'beta'));
    writeFileSync(join(tempDir, 'file.txt'), 'content');
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'cwd:browse', path: tempDir }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    const dirs = (reply as any).data.dirs as string[];
    expect(dirs.length).toBe(2);
    expect(dirs.some((d: string) => d.endsWith('alpha'))).toBe(true);
    expect(dirs.some((d: string) => d.endsWith('beta'))).toBe(true);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('cwd:addFavorite returns favorite entry', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-fav-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'cwd:addFavorite', path: '/my/project', label: 'My Project' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).data.path).toBe('/my/project');
    expect((reply as any).data.label).toBe('My Project');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('cwd:favorites returns list', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-fav-list-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'cwd:favorites' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).data.favorites).toBeInstanceOf(Array);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── file:search ──────────────────────────────────────────────────────

describe('WebSocketHandler file:search', () => {
  test('returns matching results for known content', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-search-'));
    writeFileSync(join(tempDir, 'hello.txt'), 'hello world\ngoodbye world');
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'file:search', pattern: 'hello' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).data.matches.length).toBeGreaterThan(0);
    expect((reply as any).data.matches[0].content).toContain('hello');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns empty matches for no results', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-search-empty-'));
    writeFileSync(join(tempDir, 'file.txt'), 'nothing here');
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'file:search', pattern: 'zzzznotfound' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).data.matches).toHaveLength(0);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns error for path outside session cwd', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-search-bad-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'file:search', pattern: 'test', path: '/etc' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('error');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── skill:invoke ─────────────────────────────────────────────────────

describe('WebSocketHandler skill:invoke', () => {
  test('invokes existing skill successfully', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-skill-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const mockHub = {
      ...createMockHub(),
      invokeSkill: mock((_name: string, _args?: string, _sessionId?: string) => ({
        ok: true,
        skill: 'commit',
        args: null,
        sessionId: meta.id,
        status: 'queued' as const,
      })),
    } as any;

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: mockHub,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'skill:invoke', name: 'commit' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('reply');
    expect((reply as any).data.ok).toBe(true);
    expect((reply as any).data.skill).toBe('commit');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns error for nonexistent skill', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-skill-notfound-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const mockHub = {
      ...createMockHub(),
      invokeSkill: mock(() => null),
    } as any;

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: mockHub,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'skill:invoke', name: 'nonexistent' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('skill not found');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns error when hub is not available', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-skill-nohub-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      // no hub provided
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'skill:invoke', name: 'commit' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('hub not available');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── chat command ────────────────────────────────────────────────────

describe('WebSocketHandler chat command', () => {
  test('chat returns messageId and appends user message to session', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-chat-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const sendChatMock = mock(() => Promise.resolve({ ok: true as const }));
    const mockHub = {
      ...createMockHub(),
      invokeSkill: mock(() => null),
      sendChat: sendChatMock,
      getClaudeClient: mock(() => ({})),
    } as any;

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: mockHub,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'Hello Claude' }),
    );

    const reply = findReply(ws, 'c1');
    expect(reply).toBeDefined();
    expect((reply as any).cmdId).toBe('c1');
    expect((reply as any).data.messageId).toBeDefined();
    expect(typeof (reply as any).data.messageId).toBe('string');

    // Verify message was appended to session
    const session = sessionManager.getSession(meta.id);
    const userMessages = session!.messages.filter((m) => m.role === 'user');
    expect(userMessages.length).toBe(1);
    expect(userMessages[0]!.content[0]).toEqual({ type: 'text', text: 'Hello Claude' });

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('chat publishes session status change event', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-chat-event-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const mockHub = {
      ...createMockHub(),
      invokeSkill: mock(() => null),
      sendChat: mock(() => Promise.resolve({ ok: true as const })),
      getClaudeClient: mock(() => ({})),
    } as any;

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: mockHub,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    const events: any[] = [];
    eventBus.subscribe(meta.id, (e) => { events.push(e); });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'Hi' }),
    );

    const statusEvents = events.filter((e) => e.type === 'hub:session:statusChanged');
    expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    expect(statusEvents[0].status).toBe('active');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('standby client cannot send chat', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-chat-standby-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const mockHub = {
      ...createMockHub(),
      invokeSkill: mock(() => null),
      sendChat: mock(() => Promise.resolve({ ok: true as const })),
    } as any;

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: mockHub,
    });

    // First client becomes writer
    const ws1 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid' });

    // Second client becomes standby
    const ws2 = createMockWs();
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid' });
    ws2.sentMessages.length = 0;

    await handler.handleMessage(
      clientId2!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'Hi' }),
    );

    const reply = parseSent(ws2, 0);
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('requires active writer role');

    handler.handleDisconnect(clientId1!);
    handler.handleDisconnect(clientId2!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── chat:clear ──────────────────────────────────────────────────────

describe('WebSocketHandler chat:clear', () => {
  test('clears session messages and publishes event', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-clear-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    // Add some messages to the session
    const session = sessionManager.getSession(meta.id)!;
    session.messages.push({
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    session.messages.push({
      id: 'msg-2',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    const events: any[] = [];
    eventBus.subscribe(meta.id, (e) => { events.push(e); });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat:clear' }),
    );

    const reply = findReply(ws, 'c1');
    expect(reply.type).toBe('reply');
    expect((reply as any).data.ok).toBe(true);

    // Messages should be cleared
    expect(session.messages).toHaveLength(0);

    // Event should have been published
    const clearEvents = events.filter((e) => e.type === 'hub:chat:cleared');
    expect(clearEvents.length).toBe(1);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── chat:compact ────────────────────────────────────────────────────

describe('WebSocketHandler chat:compact', () => {
  test('compacts session messages via ClaudeClient', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-compact-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const session = sessionManager.getSession(meta.id)!;
    session.messages.push({
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const compactedMessages = [{
      id: 'compact-1',
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '[Context Summary]\nUser said hello' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];

    const compactMock = mock(() => Promise.resolve(compactedMessages));
    const mockHub = {
      ...createMockHub(),
      invokeSkill: mock(() => null),
      sendChat: mock(() => Promise.resolve({ ok: true as const })),
      getClaudeClient: mock(() => ({ compact: compactMock })),
    } as any;

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: mockHub,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    const events: any[] = [];
    eventBus.subscribe(meta.id, (e) => { events.push(e); });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat:compact' }),
    );

    const reply = findReply(ws, 'c1');
    expect(reply.type).toBe('reply');
    expect((reply as any).data.ok).toBe(true);
    expect((reply as any).data.messageCount).toBe(1);

    // Session messages should be replaced
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]!.id).toBe('compact-1');

    // Event should have been published
    const compactEvents = events.filter((e) => e.type === 'hub:chat:compacted');
    expect(compactEvents.length).toBe(1);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns error when hub is not available for compact', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-compact-nohub-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      // no hub
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat:compact' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('hub not available');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── chat:branch ─────────────────────────────────────────────────────

describe('WebSocketHandler chat:branch', () => {
  test('creates branched session with truncated messages', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-branch-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const session = sessionManager.getSession(meta.id)!;
    session.messages.push(
      {
        id: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: 'First message' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'msg-3',
        role: 'user',
        content: [{ type: 'text', text: 'Second message' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    );

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    const events: any[] = [];
    eventBus.subscribe(meta.id, (e) => { events.push(e); });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat:branch', messageId: 'msg-2', name: 'my-branch' }),
    );

    const reply = findReply(ws, 'c1');
    expect(reply.type).toBe('reply');
    const newSessionMeta = (reply as any).data;
    expect(newSessionMeta.id).toBeDefined();
    expect(newSessionMeta.name).toBe('my-branch');

    // New session should have messages up to msg-2
    const newSession = sessionManager.getSession(newSessionMeta.id);
    expect(newSession).not.toBeNull();
    expect(newSession!.messages).toHaveLength(2);
    expect(newSession!.messages[0]!.id).toBe('msg-1');
    expect(newSession!.messages[1]!.id).toBe('msg-2');

    // Original session should be unchanged
    expect(session.messages).toHaveLength(3);

    // Event should have been published
    const branchEvents = events.filter((e) => e.type === 'hub:chat:branched');
    expect(branchEvents.length).toBe(1);
    expect(branchEvents[0].newSessionId).toBe(newSessionMeta.id);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns error for invalid messageId', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-branch-bad-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const session = sessionManager.getSession(meta.id)!;
    session.messages.push({
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'c1', cmd: 'chat:branch', messageId: 'nonexistent' }),
    );

    const reply = parseSent(ws, 0);
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('message not found');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('chat:branch/compact/clear require active writer', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-branch-standby-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    // First client becomes writer
    const ws1 = createMockWs();
    const clientId1 = handler.handleUpgrade(ws1, { ticket: 'valid' });

    // Second client becomes standby
    const ws2 = createMockWs();
    const clientId2 = handler.handleUpgrade(ws2, { ticket: 'valid' });
    ws2.sentMessages.length = 0;

    for (const cmd of ['chat:clear', 'chat:compact', 'chat:branch']) {
      ws2.sentMessages.length = 0;
      await handler.handleMessage(
        clientId2!,
        JSON.stringify({ cmdId: `c-${cmd}`, cmd, messageId: 'msg-1' }),
      );
      const reply = parseSent(ws2, 0);
      expect(reply.type).toBe('error');
      expect((reply as any).error).toContain('requires active writer role');
    }

    handler.handleDisconnect(clientId1!);
    handler.handleDisconnect(clientId2!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── chat:abort ─────────────────────────────────────────────────────────

describe('chat:abort', () => {
  test('returns success reply when hub is present', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-abort-hub-'));
    const meta = sessionManager.createSession({ cwd: tempDir });
    const abortChat = mock(() => Promise.resolve());
    const hub = createMockHub({ abortChat });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
      hub: hub as any,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'a1', cmd: 'chat:abort' }),
    );

    const reply = findReply(ws, 'a1');
    expect(reply.type).toBe('reply');
    expect((reply as any).data).toEqual({ ok: true });
    expect(abortChat).toHaveBeenCalledTimes(1);

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns success reply without hub (idempotent)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-abort-nohub-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({ cmdId: 'a2', cmd: 'chat:abort' }),
    );

    const reply = findReply(ws, 'a2');
    expect(reply.type).toBe('reply');
    expect((reply as any).data).toEqual({ ok: true });

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('rejects standby client', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-abort-standby-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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
      JSON.stringify({ cmdId: 'a3', cmd: 'chat:abort' }),
    );

    const reply = parseSent(ws2, 0);
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('requires active writer');

    handler.handleDisconnect(clientId1!);
    handler.handleDisconnect(clientId2!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── control:respond ─────────────────────────────────────────────────

describe('WebSocketHandler control:respond', () => {
  test('responds to pending permission request successfully', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-control-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const session = sessionManager.getSession(meta.id)!;
    session.pendingPermissions.push({
      id: 'perm-1',
      sessionId: meta.id,
      toolName: 'bash',
      toolInput: { cmd: 'rm -rf /' },
      createdAt: Date.now(),
    });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws = createMockWs();
    const clientId = handler.handleUpgrade(ws, { ticket: 'valid' });

    const events: any[] = [];
    eventBus.subscribe(meta.id, (e) => { events.push(e); });
    ws.sentMessages.length = 0;

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'cr1',
        cmd: 'control:respond',
        requestId: 'perm-1',
        response: { type: 'control_response', requestId: 'perm-1', response: { decision: 'allow' } },
      }),
    );

    const reply = findReply(ws, 'cr1');
    expect(reply.type).toBe('reply');
    expect((reply as any).data).toEqual({ ok: true });

    // Permission should be removed from pending
    expect(session.pendingPermissions).toHaveLength(0);

    // Event should have been published with correct fields
    const controlEvents = events.filter((e) => e.type === 'sdk:control:response');
    expect(controlEvents.length).toBe(1);
    expect(controlEvents[0].requestId).toBe('perm-1');
    expect(controlEvents[0].toolName).toBe('bash');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns error for invalid requestId', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-control-bad-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

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

    await handler.handleMessage(
      clientId!,
      JSON.stringify({
        cmdId: 'cr2',
        cmd: 'control:respond',
        requestId: 'nonexistent',
        response: { type: 'control_response', requestId: 'nonexistent', response: { decision: 'deny' } },
      }),
    );

    const reply = findReply(ws, 'cr2');
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('permission request not found');

    handler.handleDisconnect(clientId!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('only active writer can respond to permissions', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ws-control-standby-'));
    const meta = sessionManager.createSession({ cwd: tempDir });

    const handler = new WebSocketHandler({
      sessionManager,
      eventBus,
      connectionManager,
      ticketValidator: createValidTicketValidator({ sessionId: meta.id }),
      heartbeatIntervalMs: 999999,
    });

    const ws1 = createMockWs();
    const c1 = handler.handleUpgrade(ws1, { ticket: 'valid' });
    const ws2 = createMockWs();
    const c2 = handler.handleUpgrade(ws2, { ticket: 'valid' });
    ws2.sentMessages.length = 0;

    await handler.handleMessage(
      c2!,
      JSON.stringify({
        cmdId: 'cr3',
        cmd: 'control:respond',
        requestId: 'perm-1',
        response: { type: 'control_response', requestId: 'perm-1', response: { decision: 'allow' } },
      }),
    );

    const reply = findReply(ws2, 'cr3');
    expect(reply.type).toBe('error');
    expect((reply as any).error).toContain('requires active writer role');

    handler.handleDisconnect(c1!);
    handler.handleDisconnect(c2!);
    handler.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

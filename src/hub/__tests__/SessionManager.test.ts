import { beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import { SessionManager } from '@/hub/SessionManager';
import type { Session } from '@/shared/types';

function createMockStore() {
  return {
    databasePath: ':memory:',
    maxSessions: 10,
    maxMessagesInMemory: 1000,
    connect: mock(() => ({}) as any),
    listSessions: mock(() => []),
    getSession: mock(() => null),
    saveSession: mock(() => {}),
    appendMessage: mock(() => {}),
    replaceTasks: mock(() => {}),
    searchHistory: mock(() => []),
    close: mock(() => {}),
  };
}

function createMockEventBus() {
  return {
    listeners: new Map(),
    seqBySession: new Map(),
    subscribe: mock(() => () => {}),
    nextSeq: mock((sessionId: string) => {
      const next = (mockEventBus.seqBySession.get(sessionId) ?? 0) + 1;
      mockEventBus.seqBySession.set(sessionId, next);
      return next;
    }),
    getSeq: mock((sessionId: string) => mockEventBus.seqBySession.get(sessionId) ?? 0),
    publish: mock(async () => {}),
  };
}

let mockStore: ReturnType<typeof createMockStore>;
let mockEventBus: ReturnType<typeof createMockEventBus>;
let manager: SessionManager;

beforeEach(() => {
  mockStore = createMockStore();
  mockEventBus = createMockEventBus();
  manager = new SessionManager(mockStore as any, mockEventBus as any, {
    maxSessions: 3,
    defaultIdleTimeoutMs: 5000,
  });
});

// ── CRUD ────────────────────────────────────────────────────────────

describe('SessionManager CRUD', () => {
  test('createSession returns a SessionMeta with active status', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    expect(meta.id).toBeTruthy();
    expect(meta.cwd).toBe('/tmp');
    expect(meta.status).toBe('active');
    expect(meta.name).toContain('session-');
    expect(mockStore.saveSession).toHaveBeenCalledTimes(1);
  });

  test('createSession with custom name', () => {
    const meta = manager.createSession({ cwd: '/tmp', name: 'my-session' });
    expect(meta.name).toBe('my-session');
  });

  test('getSession returns the created session', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    const session = manager.getSession(meta.id);
    expect(session).not.toBeNull();
    expect(session?.id).toBe(meta.id);
    expect(session?.status).toBe('active');
    expect(session?.messages).toEqual([]);
    expect(session?.tasks).toEqual([]);
  });

  test('getSession returns null for unknown id', () => {
    expect(manager.getSession('nonexistent')).toBeNull();
  });

  test('listSessions returns all sessions', () => {
    manager.createSession({ cwd: '/a' });
    manager.createSession({ cwd: '/b' });
    const list = manager.listSessions();
    expect(list).toHaveLength(2);
  });

  test('listSessions filters by status', () => {
    const s1 = manager.createSession({ cwd: '/a' });
    manager.createSession({ cwd: '/b' });
    manager.archiveSession(s1.id);
    const active = manager.listSessions({ status: 'active' });
    expect(active).toHaveLength(1);
    const archived = manager.listSessions({ status: 'archived' });
    expect(archived).toHaveLength(1);
  });

  test('archiveSession sets status to archived', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.archiveSession(meta.id);
    const session = manager.getSession(meta.id);
    expect(session?.status).toBe('archived');
  });

  test('renameSession updates session name', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    manager.renameSession(meta.id, 'new-name');
    const session = manager.getSession(meta.id);
    expect(session?.name).toBe('new-name');
  });

  test('switchCwd updates cwd and emits event', () => {
    const meta = manager.createSession({ cwd: '/old' });
    manager.switchCwd(meta.id, '/new');
    const session = manager.getSession(meta.id);
    expect(session?.cwd).toBe('/new');
    expect(mockEventBus.publish).toHaveBeenCalled();
  });

  test('operations on nonexistent session throw', () => {
    expect(() => manager.renameSession('bad-id', 'x')).toThrow('session not found');
    expect(() => manager.switchCwd('bad-id', '/')).toThrow('session not found');
  });

  test('getSnapshot returns reconnect-safe session snapshot', () => {
    const meta = manager.createSession({ cwd: '/tmp', name: 'snapshot-session' });
    const session = manager.getSession(meta.id);
    expect(session).not.toBeNull();

    session!.messages.push({
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      createdAt: 1000,
      updatedAt: 1000,
    });
    session!.tasks.push({
      id: 'task-1',
      sessionId: meta.id,
      subject: 'Do work',
      description: 'Do work',
      status: 'in_progress',
      createdAt: 1000,
      updatedAt: 1000,
    });
    session!.tasks.push({
      id: 'task-2',
      sessionId: meta.id,
      subject: 'Done work',
      description: 'Done work',
      status: 'completed',
      createdAt: 1001,
      updatedAt: 1001,
    });
    session!.pendingPermissions.push({
      id: 'perm-1',
      sessionId: meta.id,
      toolName: 'bash',
      toolInput: { cmd: 'ls' },
      createdAt: 1000,
    });
    session!.clients.push({
      id: 'client-1',
      type: 'web',
      writerStatus: 'active',
      connectedAt: 1000,
    });
    mockEventBus.seqBySession.set(meta.id, 7);
    manager.assignWriter(meta.id, 'client-1');

    const snapshot = manager.getSnapshot(meta.id, 'client-1');

    expect(snapshot.meta.id).toBe(meta.id);
    expect(snapshot.meta.name).toBe('snapshot-session');
    expect(snapshot.meta.clientCount).toBe(1);
    expect(snapshot.meta.hasActiveWriter).toBe(true);
    expect(snapshot.recentMessages).toHaveLength(1);
    expect(snapshot.activeTasks).toHaveLength(1);
    expect(snapshot.activeTasks[0]?.id).toBe('task-1');
    expect(snapshot.pendingPermissions).toHaveLength(1);
    expect(snapshot.clients).toHaveLength(1);
    expect(snapshot.myWriterStatus).toBe('active');
    expect(snapshot.lastSeq).toBe(7);
  });

  test('getSnapshot throws for unknown session', () => {
    expect(() => manager.getSnapshot('missing', 'client-1')).toThrow('session not found');
  });
});

// ── Status transitions ──────────────────────────────────────────────

describe('SessionManager status transitions', () => {
  test('active → idle succeeds', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'idle');
    expect(manager.getSession(meta.id)?.status).toBe('idle');
  });

  test('active → interrupted succeeds', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'interrupted');
    expect(manager.getSession(meta.id)?.status).toBe('interrupted');
  });

  test('active → archived succeeds', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'archived');
    expect(manager.getSession(meta.id)?.status).toBe('archived');
  });

  test('idle → active succeeds', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'idle');
    await manager.updateStatus(meta.id, 'active');
    expect(manager.getSession(meta.id)?.status).toBe('active');
  });

  test('idle → archived succeeds', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'idle');
    await manager.updateStatus(meta.id, 'archived');
    expect(manager.getSession(meta.id)?.status).toBe('archived');
  });

  test('interrupted → active succeeds', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'interrupted');
    await manager.updateStatus(meta.id, 'active');
    expect(manager.getSession(meta.id)?.status).toBe('active');
  });

  test('interrupted → archived succeeds', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'interrupted');
    await manager.updateStatus(meta.id, 'archived');
    expect(manager.getSession(meta.id)?.status).toBe('archived');
  });

  test('archived → any throws', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'archived');
    await expect(manager.updateStatus(meta.id, 'active')).rejects.toThrow('invalid transition');
    await expect(manager.updateStatus(meta.id, 'idle')).rejects.toThrow('invalid transition');
  });

  test('active → active throws (no self-transition)', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await expect(manager.updateStatus(meta.id, 'active')).rejects.toThrow('invalid transition');
  });

  test('idle → interrupted throws', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'idle');
    await expect(manager.updateStatus(meta.id, 'interrupted')).rejects.toThrow(
      'invalid transition',
    );
  });

  test('status change emits event', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'idle');
    const calls = mockEventBus.publish.mock.calls;
    const statusEvent = calls.find(
      (c: any[]) => c[1]?.type === 'hub:session:statusChanged',
    ) as unknown as [string, { status: string }] | undefined;
    expect(statusEvent).toBeTruthy();
    expect(statusEvent?.[1].status).toBe('idle');
  });
});

// ── Idle timeout ────────────────────────────────────────────────────

describe('SessionManager idle timeout', () => {
  test('session transitions to idle after timeout', async () => {
    // Use a very short timeout
    const shortManager = new SessionManager(mockStore as any, mockEventBus as any, {
      maxSessions: 3,
      defaultIdleTimeoutMs: 50,
    });
    const meta = shortManager.createSession({ cwd: '/tmp' });

    // Wait for the timeout to fire
    await new Promise((r) => setTimeout(r, 100));

    const session = shortManager.getSession(meta.id);
    expect(session?.status).toBe('idle');
  });

  test('touchSession resets idle timer and reactivates idle session', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    await manager.updateStatus(meta.id, 'idle');
    await manager.touchSession(meta.id);
    expect(manager.getSession(meta.id)?.status).toBe('active');
  });
});

// ── Active writer ───────────────────────────────────────────────────

describe('SessionManager active writer', () => {
  test('assignWriter succeeds for first client', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    expect(manager.assignWriter(meta.id, 'client-1')).toBe(true);
    expect(manager.getActiveWriter(meta.id)).toBe('client-1');
  });

  test('assignWriter fails when another client holds writer', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    manager.assignWriter(meta.id, 'client-1');
    expect(manager.assignWriter(meta.id, 'client-2')).toBe(false);
    expect(manager.getActiveWriter(meta.id)).toBe('client-1');
  });

  test('assignWriter succeeds for same client again', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    manager.assignWriter(meta.id, 'client-1');
    expect(manager.assignWriter(meta.id, 'client-1')).toBe(true);
  });

  test('releaseWriter clears the active writer', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    manager.assignWriter(meta.id, 'client-1');
    manager.releaseWriter(meta.id, 'client-1');
    expect(manager.getActiveWriter(meta.id)).toBeNull();
  });

  test('releaseWriter does nothing if clientId does not match', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    manager.assignWriter(meta.id, 'client-1');
    manager.releaseWriter(meta.id, 'client-2');
    expect(manager.getActiveWriter(meta.id)).toBe('client-1');
  });

  test('takeOverWriter replaces the current writer and emits event', async () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    manager.assignWriter(meta.id, 'client-1');
    await manager.takeOverWriter(meta.id, 'client-2');
    expect(manager.getActiveWriter(meta.id)).toBe('client-2');

    const calls = mockEventBus.publish.mock.calls;
    const writerEvent = calls.find((c: any[]) => c[1]?.type === 'hub:writer:changed') as unknown as
      | [string, { newWriterId: string }]
      | undefined;
    expect(writerEvent).toBeTruthy();
    expect(writerEvent?.[1].newWriterId).toBe('client-2');
  });

  test('getActiveWriter returns null when no writer assigned', () => {
    const meta = manager.createSession({ cwd: '/tmp' });
    expect(manager.getActiveWriter(meta.id)).toBeNull();
  });
});

// ── Crash recovery ──────────────────────────────────────────────────

describe('SessionManager crash recovery', () => {
  test('recoverFromCrash marks active sessions as interrupted', async () => {
    const s1 = manager.createSession({ cwd: '/a' });
    const s2 = manager.createSession({ cwd: '/b' });
    // Make s2 idle first
    await manager.updateStatus(s2.id, 'idle');

    await manager.recoverFromCrash();

    expect(manager.getSession(s1.id)?.status).toBe('interrupted');
    // idle sessions remain idle (not active, so not affected)
    expect(manager.getSession(s2.id)?.status).toBe('idle');
  });

  test('recoverFromCrash persists to store', async () => {
    manager.createSession({ cwd: '/tmp' });
    const saveCountBefore = mockStore.saveSession.mock.calls.length;
    await manager.recoverFromCrash();
    expect(mockStore.saveSession.mock.calls.length).toBeGreaterThan(saveCountBefore);
  });
});

// ── Resource limits ─────────────────────────────────────────────────

describe('SessionManager resource limits', () => {
  test('creating sessions up to limit succeeds', () => {
    manager.createSession({ cwd: '/a' });
    manager.createSession({ cwd: '/b' });
    manager.createSession({ cwd: '/c' });
    expect(manager.listSessions()).toHaveLength(3);
  });

  test('exceeding limit auto-archives oldest idle session', async () => {
    const s1 = manager.createSession({ cwd: '/a' });
    manager.createSession({ cwd: '/b' });
    manager.createSession({ cwd: '/c' });

    // Make s1 idle so it can be auto-archived
    await manager.updateStatus(s1.id, 'idle');

    // This should auto-archive s1
    const s4 = manager.createSession({ cwd: '/d' });
    expect(s4).toBeTruthy();
    expect(manager.getSession(s1.id)?.status).toBe('archived');
  });

  test('exceeding limit with no idle sessions throws', () => {
    manager.createSession({ cwd: '/a' });
    manager.createSession({ cwd: '/b' });
    manager.createSession({ cwd: '/c' });

    expect(() => manager.createSession({ cwd: '/d' })).toThrow('max sessions limit reached');
  });
});

// ── Graceful shutdown ───────────────────────────────────────────────

describe('SessionManager shutdown', () => {
  test('shutdown archives idle sessions and interrupts active ones', async () => {
    const s1 = manager.createSession({ cwd: '/a' });
    const s2 = manager.createSession({ cwd: '/b' });
    await manager.updateStatus(s2.id, 'idle');

    await manager.shutdown();

    expect(manager.getSession(s1.id)?.status).toBe('interrupted');
    expect(manager.getSession(s2.id)?.status).toBe('archived');
  });

  test('shutdown persists all sessions to store', async () => {
    manager.createSession({ cwd: '/a' });
    manager.createSession({ cwd: '/b' });
    const saveCountBefore = mockStore.saveSession.mock.calls.length;

    await manager.shutdown();

    expect(mockStore.saveSession.mock.calls.length).toBeGreaterThan(saveCountBefore);
  });
});

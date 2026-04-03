import { afterEach, describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from './Hub.js';
import type { ClaudeClient, ClaudeChatRequest, ClaudeStreamHandle } from './ClaudeClient.js';

const socketPath = join(tmpdir(), `claude-remote-hub-${process.pid}.sock`);

afterEach(async () => {
  if (existsSync(socketPath)) {
    await rm(socketPath, { force: true });
  }
});

describe('Hub', () => {
  test('reports running status after start', async () => {
    const hub = new Hub({ socketPath });
    await hub.start();

    expect(hub.getStatus().running).toBe(true);

    await hub.stop();
  });

  test('delegates session config reads and writes to SessionManager', () => {
    const hub = new Hub({ socketPath });
    const session = hub.createSession({ cwd: '/tmp/project', name: 'config-session' });
    const managerConfig = {
      model: 'claude-opus',
      effortLevel: 'low' as const,
      permissionMode: 'approve' as const,
    };
    const sessionManager = {
      ensureSession: mock(() => {}),
      getConfig: mock((sessionId: string) => {
        return sessionId === session.id ? managerConfig : null;
      }),
      updateConfig: mock((sessionId: string, patch: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        expect(patch).toEqual({ model: 'claude-opus' });
        return managerConfig;
      }),
    };

    (hub as any).sessionManager = sessionManager;

    const updated = hub.updateSessionConfig(session.id, { model: 'claude-opus' });
    expect(updated).toEqual(managerConfig);
    expect(sessionManager.updateConfig).toHaveBeenCalledTimes(1);

    expect(hub.getSessionConfig(session.id)).toEqual(managerConfig);
    expect(sessionManager.getConfig).toHaveBeenCalledWith(session.id);

    const snapshot = hub.getSessionSnapshot(session.id);
    expect(snapshot?.config).toEqual(managerConfig);
  });

  test('sendChat appends user message and calls ClaudeClient', async () => {
    const mockSendMessage = mock(async (_req: ClaudeChatRequest): Promise<ClaudeStreamHandle> => {
      return { cancel: async () => {} };
    });
    const mockAbort = mock(async () => {});
    const mockShutdown = mock(() => {});

    const mockClient = {
      sendMessage: mockSendMessage,
      abort: mockAbort,
      shutdown: mockShutdown,
    } as unknown as ClaudeClient;

    const hub = new Hub({ socketPath, claudeClient: mockClient });
    const session = hub.createSession({ cwd: '/tmp/test', name: 'chat-test' });

    const result = await hub.sendChat(session.id, 'hello claude');
    expect(result).toEqual({ ok: true });

    // Verify user message was appended
    const updatedSession = hub.getSession(session.id);
    expect(updatedSession?.messages).toHaveLength(1);
    expect(updatedSession?.messages[0]?.role).toBe('user');
    expect(updatedSession?.messages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: 'hello claude',
    });

    // Verify ClaudeClient.sendMessage was called
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMessage.mock.calls[0]![0] as ClaudeChatRequest;
    expect(callArgs.sessionId).toBe(session.id);
    expect(callArgs.messages).toHaveLength(1);
  });

  test('sendChat returns error for nonexistent session', async () => {
    const hub = new Hub({ socketPath });
    const result = await hub.sendChat('nonexistent', 'hello');
    expect(result).toMatchObject({ ok: false });
    expect((result as any).error).toContain('not found');
  });

  test('sendChat returns error when ClaudeClient throws', async () => {
    const mockClient = {
      sendMessage: mock(async () => {
        throw new Error('API key invalid');
      }),
      abort: mock(async () => {}),
      shutdown: mock(() => {}),
    } as unknown as ClaudeClient;

    const hub = new Hub({ socketPath, claudeClient: mockClient });
    const session = hub.createSession({ cwd: '/tmp/test', name: 'error-test' });

    const result = await hub.sendChat(session.id, 'hello');
    expect(result).toMatchObject({ ok: false, error: 'API key invalid' });
  });

  test('abortChat calls ClaudeClient.abort', async () => {
    const mockAbort = mock(async () => {});
    const mockClient = {
      sendMessage: mock(async () => ({ cancel: async () => {} })),
      abort: mockAbort,
      shutdown: mock(() => {}),
    } as unknown as ClaudeClient;

    const hub = new Hub({ socketPath, claudeClient: mockClient });
    const session = hub.createSession({ cwd: '/tmp/test', name: 'abort-test' });

    await hub.abortChat(session.id);
    expect(mockAbort).toHaveBeenCalledWith(session.id);
  });
});

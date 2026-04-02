import { afterEach, describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from './Hub.js';

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
});

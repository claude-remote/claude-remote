import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';

import { CloudflaredManager } from '../cloudflared';

class MockProcess extends EventEmitter {
  pid?: number;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

describe('CloudflaredManager', () => {
  it('ensureInstalled returns true when cloudflared --version exits 0', async () => {
    const manager = new CloudflaredManager(() => {
      const child = new MockProcess();
      queueMicrotask(() => child.emit('exit', 0));
      return child as never;
    });

    await expect(manager.ensureInstalled()).resolves.toBe(true);
  });

  it('ensureInstalled returns false when spawn fails', async () => {
    const manager = new CloudflaredManager(() => {
      const child = new MockProcess();
      queueMicrotask(() => child.emit('error', new Error('missing')));
      return child as never;
    });

    await expect(manager.ensureInstalled()).resolves.toBe(false);
  });

  it('startQuickTunnel resolves with parsed trycloudflare url and pid', async () => {
    let callCount = 0;
    const manager = new CloudflaredManager(() => {
      callCount += 1;
      const child = new MockProcess();
      if (callCount === 1) {
        queueMicrotask(() => child.emit('exit', 0));
      } else {
        child.pid = 4321;
        queueMicrotask(() => {
          child.stderr.emit('data', Buffer.from('INF | https://demo.trycloudflare.com ready'));
        });
      }
      return child as never;
    });

    await expect(manager.startQuickTunnel()).resolves.toEqual({
      url: 'https://demo.trycloudflare.com',
      pid: 4321,
    });
  });

  it('startQuickTunnel rejects when cloudflared is missing', async () => {
    const manager = new CloudflaredManager(() => {
      const child = new MockProcess();
      queueMicrotask(() => child.emit('error', new Error('not found')));
      return child as never;
    });

    await expect(manager.startQuickTunnel()).rejects.toThrow(/cloudflared is not installed/i);
  });
});

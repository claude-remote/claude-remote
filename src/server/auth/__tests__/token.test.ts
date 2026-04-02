import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearAuthFailures,
  clearBootstrapTokenStore,
  clearWsTicketStore,
  consumeBootstrapToken,
  consumeWsTicket,
  createBootstrapToken,
  createWsTicket,
  ensureMasterToken,
  getMasterTokenPath,
  isIpBanned,
  recordAuthFailure,
  rotateMasterToken,
  signSessionToken,
  verifySessionToken,
} from '@/server/auth/token';
import {
  DEFAULT_AUTH_BLOCK_WINDOW_MS,
  DEFAULT_AUTH_RATE_LIMIT_MAX_FAILURES,
  DEFAULT_BOOTSTRAP_TOKEN_TTL_MS,
  DEFAULT_WS_TICKET_TTL_MS,
} from '@/shared/constants';

describe('Token authentication module', () => {
  const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'token-auth-test-'));
  const configDir = path.join(tmpBase, 'hub-data');

  beforeEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(configDir, { recursive: true });
    process.env.CLAUDE_REMOTE_CONFIG_DIR = configDir;

    clearAuthFailures();
    clearBootstrapTokenStore();
    clearWsTicketStore();
  });

  test('master token generation, persist and read', async () => {
    const tokenA = await ensureMasterToken(configDir);
    const tokenPath = getMasterTokenPath(configDir);
    expect(existsSync(tokenPath)).toBe(true);
    expect(readFileSync(tokenPath, 'utf8')).toBe(tokenA);

    const tokenB = await ensureMasterToken(configDir);
    expect(tokenB).toBe(tokenA);

    const rotated = await rotateMasterToken(configDir);
    expect(rotated).not.toBe(tokenA);
    expect(readFileSync(tokenPath, 'utf8')).toBe(rotated);
  });

  test('session token sign and verify plus expiry handling', async () => {
    const now = Date.now();
    const token = await signSessionToken('user-123', {
      now,
      configDir,
    });

    const verified = await verifySessionToken(token, { now, configDir });
    expect(verified?.userId).toBe('user-123');
    expect(verified?.needsRenewal).toBe(false);

    const nearExpiryToken = await signSessionToken('user-123', {
      now: now - 6.5 * 24 * 60 * 60 * 1000,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      configDir,
    });
    const renewalInfo = await verifySessionToken(nearExpiryToken, { now, configDir });
    expect(renewalInfo?.needsRenewal).toBe(true);

    const expiredToken = await signSessionToken('user-123', {
      now: now - 8 * 24 * 60 * 60 * 1000,
      ttlMs: 1 * 24 * 60 * 60 * 1000,
      configDir,
    });
    const expired = await verifySessionToken(expiredToken, { now, configDir });
    expect(expired).toBeNull();
  });

  test('bootstrap token consume one-time and expiration', async () => {
    const bootstrap = createBootstrapToken();
    const now = Date.now();

    expect(consumeBootstrapToken(bootstrap, { now })).toEqual({ userId: undefined });
    expect(consumeBootstrapToken(bootstrap, { now })).toBeNull();

    const expiredBootstrap = createBootstrapToken({ now });
    expect(
      consumeBootstrapToken(expiredBootstrap, {
        now: now + DEFAULT_BOOTSTRAP_TOKEN_TTL_MS + 1,
      }),
    ).toBeNull();
  });

  test('WS ticket consume one-time and expiration', async () => {
    const ticket = createWsTicket('user-123');
    const now = Date.now();

    expect(consumeWsTicket(ticket, { now })).toEqual({ userId: 'user-123' });
    expect(consumeWsTicket(ticket, { now })).toBeNull();

    const expiredTicket = createWsTicket('user-456');
    expect(
      consumeWsTicket(expiredTicket, {
        now: now + DEFAULT_WS_TICKET_TTL_MS + 1,
      }),
    ).toBeNull();
  });

  test('rate limiting allows 4 failures and blocks on 5th then recovers', async () => {
    const ip = '192.0.2.10';

    for (let i = 0; i < DEFAULT_AUTH_RATE_LIMIT_MAX_FAILURES - 1; i++) {
      expect(isIpBanned(ip)).toBe(false);
      recordAuthFailure(ip);
      expect(isIpBanned(ip)).toBe(false);
    }

    recordAuthFailure(ip);
    const now = Date.now();
    expect(isIpBanned(ip, { now })).toBe(true);

    expect(isIpBanned(ip, { now: now + DEFAULT_AUTH_BLOCK_WINDOW_MS - 1 })).toBe(true);
    expect(isIpBanned(ip, { now: now + DEFAULT_AUTH_BLOCK_WINDOW_MS + 1 })).toBe(false);
  });
});

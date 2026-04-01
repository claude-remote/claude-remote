import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SESSION_COOKIE_NAME } from '@/shared/constants';
import { authMiddleware } from '@/server/auth/middleware';
import {
  clearAuthFailures,
  clearMasterTokenCache,
  rotateMasterToken,
  signSessionToken,
} from '@/server/auth/token';

type HeaderMap = Record<string, string | undefined>;

function createContext(headers: HeaderMap) {
  const normalized = new Map(
    Object.entries(headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key.toLowerCase(), value]),
  );

  let nextCalled = false;
  let response: { body: unknown; status?: number } | undefined;

  const context = {
    req: {
      header(name: string) {
        return normalized.get(name.toLowerCase());
      },
      path: '/api/sessions',
      url: 'http://localhost:7680/api/sessions',
    },
    set() {},
    header() {},
    json(body: unknown, status?: number) {
      response = { body, status };
      return response as Response;
    },
  };

  return {
    async run() {
      await authMiddleware(context as never, async () => {
        nextCalled = true;
      });

      return { nextCalled, response };
    },
  };
}

describe('auth middleware', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = mkdtempSync(path.join(os.tmpdir(), 'auth-middleware-test-'));
    process.env.CLAUDE_REMOTE_CONFIG_DIR = configDir;
    clearAuthFailures();
    clearMasterTokenCache(configDir);
    await rotateMasterToken(configDir);
  });

  afterEach(() => {
    clearAuthFailures();
    clearMasterTokenCache(configDir);
    delete process.env.CLAUDE_REMOTE_CONFIG_DIR;
    rmSync(configDir, { recursive: true, force: true });
  });

  test('accepts a valid bearer token without an origin header', async () => {
    const token = await signSessionToken('user-1', { configDir });
    const request = createContext({
      authorization: `Bearer ${token}`,
      host: 'localhost:7680',
    });

    const result = await request.run();

    expect(result.nextCalled).toBe(true);
    expect(result.response).toBeUndefined();
  });

  test('still rejects cookie auth when origin is missing', async () => {
    const token = await signSessionToken('user-1', { configDir });
    const request = createContext({
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      host: 'localhost:7680',
    });

    const result = await request.run();

    expect(result.nextCalled).toBe(false);
    expect(result.response).toEqual({
      body: { error: 'Unauthorized' },
      status: 401,
    });
  });
});

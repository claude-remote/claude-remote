import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { clearMasterTokenCache, TokenService } from '@/server/auth/token';
import { registerAuthRoutes } from '@/server/routes/auth';
import { SESSION_COOKIE_NAME } from '@/shared/constants';

interface TestRouteResponse {
  body: unknown;
  headers: Record<string, string>;
  status: number;
}

describe('auth routes', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), 'claude-code-haha-auth-route-'));
    process.env.CLAUDE_REMOTE_CONFIG_DIR = configDir;
    clearMasterTokenCache(configDir);
  });

  afterEach(async () => {
    clearMasterTokenCache(configDir);
    delete process.env.CLAUDE_REMOTE_CONFIG_DIR;
    await rm(configDir, { recursive: true, force: true });
  });

  test('registers bootstrap token exchange route', async () => {
    const routes = new Map<string, (context: any) => unknown>();
    const app = {
      post(path: string, handler: (context: any) => unknown) {
        routes.set(path, handler);
        return this;
      },
    };
    const tokenService = new TokenService();

    registerAuthRoutes(app as never, tokenService);

    expect(routes.has('/api/auth/bootstrap')).toBe(true);

    const bootstrap = tokenService.issueBootstrapToken();
    const exchange = routes.get('/api/auth/bootstrap');
    if (!exchange) {
      throw new Error('missing bootstrap exchange route');
    }

    const okResult = (await exchange({
      req: {
        json: async () => ({ token: bootstrap.token }),
      },
      header(name: string, value: string) {
        this.headers[name] = value;
      },
      headers: {} as Record<string, string>,
      json(body: unknown, status = 200) {
        return { body, status, headers: this.headers };
      },
    })) as TestRouteResponse;

    expect(okResult).toEqual({
      body: expect.objectContaining({
        sessionToken: expect.any(String),
      }),
      headers: expect.objectContaining({
        'Set-Cookie': expect.stringContaining(`${SESSION_COOKIE_NAME}=`),
      }),
      status: 200,
    });

    const invalidResult = (await exchange({
      req: {
        json: async () => ({ token: 'nope' }),
      },
      header(name: string, value: string) {
        this.headers[name] = value;
      },
      headers: {} as Record<string, string>,
      json(body: unknown, status = 200) {
        return { body, status, headers: this.headers };
      },
    })) as TestRouteResponse;

    expect(invalidResult).toEqual({
      body: { error: 'Invalid bootstrap token' },
      headers: {},
      status: 401,
    });
  });

  test('rejects unauthenticated rotate requests', async () => {
    const routes = new Map<string, (context: any) => unknown>();
    const app = {
      post(path: string, handler: (context: any) => unknown) {
        routes.set(path, handler);
        return this;
      },
    };
    const tokenService = new TokenService();

    registerAuthRoutes(app as never, tokenService);

    const rotate = routes.get('/api/auth/rotate');
    if (!rotate) {
      throw new Error('missing rotate route');
    }

    const result = (await rotate({
      req: {
        header: () => undefined,
      },
      header(name: string, value: string) {
        this.headers[name] = value;
      },
      headers: {} as Record<string, string>,
      json(body: unknown, status = 200) {
        return { body, status, headers: this.headers };
      },
    })) as TestRouteResponse;

    expect(result).toEqual({
      body: { error: 'Unauthorized' },
      headers: {},
      status: 401,
    });
  });

  test('rotates the master token and reissues the caller session', async () => {
    const routes = new Map<string, (context: any) => unknown>();
    const app = {
      post(path: string, handler: (context: any) => unknown) {
        routes.set(path, handler);
        return this;
      },
    };
    const tokenService = new TokenService();

    registerAuthRoutes(app as never, tokenService);

    const rotate = routes.get('/api/auth/rotate');
    if (!rotate) {
      throw new Error('missing rotate route');
    }

    const issued = await tokenService.issueSessionToken({ id: 'web-client' });
    const result = (await rotate({
      req: {
        header(name: string) {
          if (name.toLowerCase() === 'cookie') {
            return `${SESSION_COOKIE_NAME}=${issued.sessionToken}`;
          }

          return undefined;
        },
      },
      header(name: string, value: string) {
        this.headers[name] = value;
      },
      headers: {} as Record<string, string>,
      json(body: unknown, status = 200) {
        return { body, status, headers: this.headers };
      },
    })) as TestRouteResponse;

    expect(result).toEqual({
      body: { ok: true, message: 'Token rotated' },
      headers: expect.objectContaining({
        'Set-Cookie': expect.stringContaining(`${SESSION_COOKIE_NAME}=`),
      }),
      status: 200,
    });
    expect(result.headers['Set-Cookie']).not.toContain(issued.sessionToken);
  });
});

describe('auth routes invalid session cookies', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), 'claude-code-haha-auth-route-'));
    process.env.CLAUDE_REMOTE_CONFIG_DIR = configDir;
    clearMasterTokenCache(configDir);
  });

  afterEach(async () => {
    clearMasterTokenCache(configDir);
    delete process.env.CLAUDE_REMOTE_CONFIG_DIR;
    await rm(configDir, { recursive: true, force: true });
  });

  test('returns 401 for rotate requests with an invalid session token', async () => {
    const routes = new Map<string, (context: any) => unknown>();
    const app = {
      post(path: string, handler: (context: any) => unknown) {
        routes.set(path, handler);
        return this;
      },
    };
    const tokenService = new TokenService();

    registerAuthRoutes(app as never, tokenService);

    const rotate = routes.get('/api/auth/rotate');
    if (!rotate) {
      throw new Error('missing rotate route');
    }

    const result = (await rotate({
      req: {
        header(name: string) {
          if (name.toLowerCase() === 'cookie') {
            return `${SESSION_COOKIE_NAME}=fake-session-token`;
          }

          return undefined;
        },
      },
      header(name: string, value: string) {
        this.headers[name] = value;
      },
      headers: {} as Record<string, string>,
      json(body: unknown, status = 200) {
        return { body, status, headers: this.headers };
      },
    })) as TestRouteResponse;

    expect(result).toEqual({
      body: { error: 'Unauthorized' },
      headers: {},
      status: 401,
    });
  });
});

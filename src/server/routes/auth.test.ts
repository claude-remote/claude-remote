import { describe, expect, test } from 'bun:test';

import { TokenService } from '@/server/auth/token';
import { registerAuthRoutes } from '@/server/routes/auth';

describe('auth routes', () => {
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

    const okResult = await exchange({
      req: {
        json: async () => ({ token: bootstrap.token }),
      },
      json(body: unknown, status = 200) {
        return { body, status };
      },
    });

    expect(okResult).toEqual({
      body: expect.objectContaining({
        sessionToken: expect.any(String),
      }),
      status: 200,
    });

    const invalidResult = await exchange({
      req: {
        json: async () => ({ token: 'nope' }),
      },
      json(body: unknown, status = 200) {
        return { body, status };
      },
    });

    expect(invalidResult).toEqual({
      body: { error: 'Invalid bootstrap token' },
      status: 401,
    });
  });
});

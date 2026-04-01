import { Hono } from 'hono';

import type { SessionMeta } from '@/shared/types';
import { TokenService } from '@/server/auth/token';

export function registerAuthRoutes(app: Hono, tokenService: TokenService): Hono {
  // TODO(T04,T06): exchange master/bootstrap tokens for httpOnly session cookies.
  app.post('/api/auth/login', async (context) => {
    const session = await tokenService.issueSessionToken({ id: 'web-client' } satisfies Pick<SessionMeta, 'id'>);
    return context.json(session);
  });

  app.post('/api/auth/bootstrap', async (context) => {
    const payload = await context.req.json().catch(() => null) as { token?: unknown } | null;
    if (!payload || typeof payload.token !== 'string' || !payload.token.trim()) {
      return context.json({ error: 'Invalid bootstrap token' }, 401);
    }

    const session = await tokenService.exchangeBootstrapToken(payload.token);
    if (!session) {
      return context.json({ error: 'Invalid bootstrap token' }, 401);
    }

    return context.json(session);
  });

  app.post('/api/ws-ticket', (context) => {
    return context.json(tokenService.issueWsTicket());
  });

  return app;
}

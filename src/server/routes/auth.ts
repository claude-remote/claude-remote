import type { Hono } from 'hono';

import type { TokenService } from '@/server/auth/token';
import type { SessionMeta } from '@/shared/types';

export function registerAuthRoutes(app: Hono, tokenService: TokenService): Hono {
  // POST /api/auth/login — exchange master token for httpOnly session cookie
  app.post('/api/auth/login', async (context) => {
    const body = (await context.req.json().catch(() => null)) as { token?: unknown } | null;
    if (!body || typeof body.token !== 'string' || !body.token.trim()) {
      return context.json({ error: 'Token required' }, 401);
    }

    // TODO(T04): validate against master token from hub.token file
    const session = await tokenService.issueSessionToken({ id: 'web-client' } satisfies Pick<
      SessionMeta,
      'id'
    >);
    // TODO(T04): set httpOnly cookie with session token
    return context.json({ ok: true, ...session });
  });

  // POST /api/auth/bootstrap — consume one-time bootstrap token, set cookie
  app.post('/api/auth/bootstrap', async (context) => {
    const payload = (await context.req.json().catch(() => null)) as { token?: unknown } | null;
    if (!payload || typeof payload.token !== 'string' || !payload.token.trim()) {
      return context.json({ error: 'Invalid bootstrap token' }, 401);
    }

    const session = await tokenService.exchangeBootstrapToken(payload.token);
    if (!session) {
      return context.json({ error: 'Invalid bootstrap token' }, 401);
    }

    // TODO(T04): set httpOnly cookie
    return context.json({ ok: true, ...session });
  });

  // POST /api/auth/rotate — rotate master token (requires auth)
  app.post('/api/auth/rotate', (_context) => {
    // TODO(T04): regenerate master token, invalidate old sessions
    return _context.json({ ok: true, message: 'Token rotated' });
  });

  // POST /api/ws-ticket — generate one-time WebSocket ticket (also registered in index.ts)
  app.post('/api/ws-ticket', (context) => {
    return context.json(tokenService.issueWsTicket());
  });

  return app;
}

import type { Hono } from 'hono';

import { rotateMasterToken, verifySessionToken } from '@/server/auth/token';
import type { TokenService } from '@/server/auth/token';
import { DEFAULT_SESSION_TOKEN_TTL_MS, SESSION_COOKIE_NAME } from '@/shared/constants';
import type { SessionMeta } from '@/shared/types';

function setSessionCookie(context: { header: (name: string, value: string) => void }, token: string): void {
  const maxAge = Math.floor(DEFAULT_SESSION_TOKEN_TTL_MS / 1000);
  const expires = new Date(Date.now() + DEFAULT_SESSION_TOKEN_TTL_MS).toUTCString();
  context.header(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}; Expires=${expires}`,
  );
}

function extractSessionCookie(cookieHeader?: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return trimmed.slice(SESSION_COOKIE_NAME.length + 1);
    }
  }

  return undefined;
}

export function registerAuthRoutes(app: Hono, tokenService: TokenService): Hono {
  // POST /api/auth/login — exchange master token for httpOnly session cookie
  app.post('/api/auth/login', async (context) => {
    const body = (await context.req.json().catch(() => null)) as { token?: unknown } | null;
    if (!body || typeof body.token !== 'string' || !body.token.trim()) {
      return context.json({ error: 'Token required' }, 401);
    }

    const masterToken = await tokenService.loadOrCreateMasterToken();
    if (body.token !== masterToken) {
      return context.json({ error: 'Invalid token' }, 401);
    }

    const session = await tokenService.issueSessionToken({ id: 'web-client' } satisfies Pick<
      SessionMeta,
      'id'
    >);
    setSessionCookie(context, session.sessionToken);
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

    setSessionCookie(context, session.sessionToken);
    return context.json({ ok: true, ...session });
  });

  // POST /api/auth/rotate — rotate master token (requires auth)
  app.post('/api/auth/rotate', async (context) => {
    const sessionToken = extractSessionCookie(context.req.header('cookie'));
    if (!sessionToken) {
      return context.json({ error: 'Unauthorized' }, 401);
    }

    const session = await verifySessionToken(sessionToken);
    if (!session) {
      return context.json({ error: 'Unauthorized' }, 401);
    }

    await rotateMasterToken();
    const nextSession = await tokenService.issueSessionToken({ id: session.userId });
    setSessionCookie(context, nextSession.sessionToken);
    return context.json({ ok: true, message: 'Token rotated' });
  });

  // POST /api/ws-ticket — generate one-time WebSocket ticket (also registered in index.ts)
  app.post('/api/ws-ticket', (context) => {
    return context.json(tokenService.issueWsTicket());
  });

  return app;
}

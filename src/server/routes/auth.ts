import { Hono } from 'hono';

import type { SessionMeta } from '@/shared/types';
import { TokenService } from '@/server/auth/token';

export function registerAuthRoutes(app: Hono, tokenService: TokenService): Hono {
  // TODO(T04,T06): exchange master/bootstrap tokens for httpOnly session cookies.
  app.post('/api/auth/login', async (context) => {
    const session = await tokenService.issueSessionToken({ id: 'web-client' } satisfies Pick<SessionMeta, 'id'>);
    return context.json(session);
  });

  app.post('/api/ws-ticket', (context) => {
    return context.json(tokenService.issueWsTicket());
  });

  return app;
}

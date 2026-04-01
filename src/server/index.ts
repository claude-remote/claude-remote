import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { Hub } from '@/hub/Hub';
import { requireAuth, requireJsonCsrf } from '@/server/auth/middleware';
import { TokenService } from '@/server/auth/token';
import { registerAuthRoutes } from '@/server/routes/auth';
import { registerConfigRoutes } from '@/server/routes/config';
import { registerFileRoutes } from '@/server/routes/files';
import { registerHealthRoutes } from '@/server/routes/health';
import { registerHistoryRoutes } from '@/server/routes/history';
import { registerMcpRoutes } from '@/server/routes/mcp';
import { registerSessionRoutes } from '@/server/routes/sessions';
import { registerSkillRoutes } from '@/server/routes/skills';

export function createServerApp(hub: Hub): Hono {
  const app = new Hono();
  const tokenService = new TokenService();

  // Global middleware
  app.use('*', logger());
  app.use('/api/*', cors({ origin: '*', credentials: true }));

  // CSRF protection for state-changing requests
  app.use('/api/*', requireJsonCsrf);

  // Auth middleware — skip health and auth/login endpoints
  app.use('/api/sessions/*', requireAuth);
  app.use('/api/files/*', requireAuth);
  app.use('/api/skills/*', requireAuth);
  app.use('/api/config/*', requireAuth);
  app.use('/api/mcp/*', requireAuth);
  app.use('/api/history/*', requireAuth);
  app.use('/api/ws-ticket', requireAuth);

  // Routes
  registerHealthRoutes(app, hub);
  registerAuthRoutes(app, tokenService);
  registerSessionRoutes(app, hub);
  registerFileRoutes(app, hub);
  registerSkillRoutes(app, hub);
  registerConfigRoutes(app, hub);
  registerMcpRoutes(app, hub);
  registerHistoryRoutes(app, hub);

  // WS ticket endpoint (authed via middleware above)
  app.post('/api/ws-ticket', (context) => {
    const ticket = tokenService.issueWsTicket();
    return context.json(ticket);
  });

  // Static files (Web frontend)
  // TODO(T08): serve built web frontend assets from ./dist/web
  // app.use('/*', serveStatic({ root: './dist/web' }));
  // SPA fallback
  // app.get('/*', serveStatic({ path: './dist/web/index.html' }));

  return app;
}

export function startServer(app: Hono, port: number) {
  return Bun.serve({ fetch: app.fetch, port });
}

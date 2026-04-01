import { Hono } from 'hono';

import { Hub } from '@/hub/Hub';
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

  // TODO(T06): wire websocket upgrade handling, static asset serving, and route-specific auth.
  app.use('/api/*', requireJsonCsrf);
  app.use('/api/sessions/*', requireAuth);

  registerAuthRoutes(app, tokenService);
  registerSessionRoutes(app, hub);
  registerFileRoutes(app, hub);
  registerSkillRoutes(app, hub);
  registerConfigRoutes(app, hub);
  registerMcpRoutes(app, hub);
  registerHistoryRoutes(app, hub);
  registerHealthRoutes(app, hub);

  return app;
}

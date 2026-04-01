import { Hono } from 'hono';

import type { SessionMeta, SessionSnapshot } from '@/shared/types';
import { Hub } from '@/hub/Hub';

export function registerSessionRoutes(app: Hono, hub: Hub): Hono {
  // TODO(T06,T03): add paginated session detail, message history, and SSE chat endpoints.
  app.get('/api/sessions', (context) => {
    const sessions: SessionMeta[] = hub.listSessions();
    return context.json({ sessions });
  });

  app.get('/api/sessions/:id', (context) => {
    const snapshot = null as SessionSnapshot | null;
    return context.json({ sessionId: context.req.param('id'), snapshot });
  });

  return app;
}

import { Hono } from 'hono';

import type { SessionMeta } from '@/shared/types';
import { Hub } from '@/hub/Hub';

export function registerFileRoutes(app: Hono, _hub: Hub): Hono {
  // TODO(T06,T17): implement whitelisted file browsing, preview, and search APIs.
  app.get('/api/files', (context) => {
    const session: Pick<SessionMeta, 'id'> = { id: context.req.query('sessionId') ?? 'unknown' };
    return context.json({ session, entries: [] });
  });

  return app;
}

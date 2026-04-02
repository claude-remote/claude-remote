import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';
import type { SessionConfig } from '@/shared/types';

export function registerConfigRoutes(app: Hono, hub: Hub): Hono {
  // GET /api/sessions/:id/config — get session config + available options
  app.get('/api/sessions/:id/config', (context) => {
    const sessionId = context.req.param('id');
    const snapshot = hub.getSessionSnapshot(sessionId);
    if (!snapshot) {
      return context.json({ error: `session ${sessionId} not found` }, 404);
    }

    return context.json({ sessionId, config: snapshot.config, options: snapshot.configOptions });
  });

  // PATCH /api/sessions/:id/config — update session config
  app.patch('/api/sessions/:id/config', async (context) => {
    const sessionId = context.req.param('id');
    const body = (await context.req.json().catch(() => ({}))) as Partial<SessionConfig>;
    const updated = hub.updateSessionConfig(sessionId, body);
    if (!updated) {
      return context.json({ error: `session ${sessionId} not found` }, 404);
    }

    return context.json({ ok: true, sessionId, updated });
  });

  // GET /api/sessions/:id/context — get context usage
  app.get('/api/sessions/:id/context', (context) => {
    const sessionId = context.req.param('id');
    const snapshot = hub.getSessionSnapshot(sessionId);
    if (!snapshot) {
      return context.json({ error: `session ${sessionId} not found` }, 404);
    }

    return context.json({ sessionId, usage: snapshot.contextUsage });
  });

  // GET /api/sessions/:id/cost — get cost summary
  app.get('/api/sessions/:id/cost', (context) => {
    const sessionId = context.req.param('id');
    const snapshot = hub.getSessionSnapshot(sessionId);
    if (!snapshot) {
      return context.json({ error: `session ${sessionId} not found` }, 404);
    }

    return context.json({ sessionId, cost: snapshot.costSummary });
  });

  // GET /api/config — get global hub config
  app.get('/api/config', (context) => {
    return context.json(hub.getGlobalConfig());
  });

  // PATCH /api/config — update global hub config
  app.patch('/api/config', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;
    const updated = hub.updateGlobalConfig(body);
    return context.json({ ok: true, updated });
  });

  return app;
}

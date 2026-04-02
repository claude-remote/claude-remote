import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';
import type { HistorySearchResult } from '@/shared/types';

export function registerHistoryRoutes(app: Hono, _hub: Hub): Hono {
  // GET /api/history/search?q=xxx&scope=session|all&sessionId=xxx&limit=20
  app.get('/api/history/search', (context) => {
    const query = context.req.query('q') ?? context.req.query('query') ?? '';
    const scope = context.req.query('scope') ?? 'session';
    const sessionId = context.req.query('sessionId');
    const limit = Number.parseInt(context.req.query('limit') ?? '20', 10);

    if (!query.trim()) {
      return context.json({ error: 'Search query required (q parameter)' }, 400);
    }

    // TODO(T24): wire to hub history search with SQLite FTS
    const results: HistorySearchResult[] = [];
    return context.json({ query, scope, sessionId: sessionId ?? null, limit, results });
  });

  return app;
}

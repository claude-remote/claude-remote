import { Hono } from 'hono';

import type { HistorySearchResult } from '@/shared/types';
import { Hub } from '@/hub/Hub';

export function registerHistoryRoutes(app: Hono, _hub: Hub): Hono {
  // TODO(T06,T24): search session or global history with highlighted snippets.
  app.get('/api/history/search', (context) => {
    const results: HistorySearchResult[] = [];
    return context.json({
      query: context.req.query('query') ?? '',
      scope: context.req.query('scope') ?? 'session',
      results,
    });
  });

  return app;
}

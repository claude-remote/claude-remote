import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';
import type { ConfigOptions, ContextUsage, CostSummary, SessionConfig } from '@/shared/types';

export function registerConfigRoutes(app: Hono, _hub: Hub): Hono {
  // GET /api/sessions/:id/config — get session config + available options
  app.get('/api/sessions/:id/config', (context) => {
    const sessionId = context.req.param('id');

    // TODO(T05,T19): wire to hub session config state
    const config: SessionConfig = {
      model: 'claude-sonnet',
      effortLevel: 'medium',
      permissionMode: 'ask',
    };
    const options: ConfigOptions = {
      availableModels: [
        { id: 'claude-sonnet', name: 'Claude Sonnet', supportsImages: true },
        { id: 'claude-opus', name: 'Claude Opus', supportsImages: true },
        { id: 'claude-haiku', name: 'Claude Haiku', supportsImages: true },
      ],
      effortLevels: ['low', 'medium', 'high'],
      permissionModes: ['ask', 'approve', 'bypass'],
    };

    return context.json({ sessionId, config, options });
  });

  // PATCH /api/sessions/:id/config — update session config
  app.patch('/api/sessions/:id/config', async (context) => {
    const sessionId = context.req.param('id');
    const body = (await context.req.json().catch(() => ({}))) as Partial<SessionConfig>;

    // TODO(T05,T19): wire to hub session config mutation
    return context.json({ ok: true, sessionId, updated: body });
  });

  // GET /api/sessions/:id/context — get context usage
  app.get('/api/sessions/:id/context', (context) => {
    const sessionId = context.req.param('id');

    // TODO(T20): wire to hub context tracking
    const usage: ContextUsage = {
      usedTokens: 0,
      maxTokens: 200000,
      percentage: 0,
      breakdown: [],
    };

    return context.json({ sessionId, usage });
  });

  // GET /api/sessions/:id/cost — get cost summary
  app.get('/api/sessions/:id/cost', (context) => {
    const sessionId = context.req.param('id');

    // TODO(T20): wire to hub cost tracking
    const cost: CostSummary = {
      sessionCost: 0,
      formattedCost: '$0.00',
      inputTokens: 0,
      outputTokens: 0,
      apiCalls: 0,
      sessionDuration: 0,
    };

    return context.json({ sessionId, cost });
  });

  // GET /api/config — get global hub config
  app.get('/api/config', (_context) => {
    // TODO(T05): wire to hub global config
    return _context.json({
      port: 7680,
      tunnel: false,
      maxSessions: 10,
      maxConcurrentTools: 5,
    });
  });

  // PATCH /api/config — update global hub config
  app.patch('/api/config', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;

    // TODO(T05): wire to hub global config mutation
    return context.json({ ok: true, updated: body });
  });

  return app;
}

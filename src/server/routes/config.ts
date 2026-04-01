import { Hono } from 'hono';

import type { ConfigOptions, ContextUsage, CostSummary, SessionConfig } from '@/shared/types';
import { Hub } from '@/hub/Hub';

export function registerConfigRoutes(app: Hono, _hub: Hub): Hono {
  // TODO(T06,T05,T19,T20): return config, context, and cost state for a session.
  app.get('/api/sessions/:id/config', (context) => {
    const config: SessionConfig = {
      model: 'claude-sonnet',
      effortLevel: 'medium',
      permissionMode: 'ask',
    };
    const options: ConfigOptions = {
      availableModels: [],
      effortLevels: ['low', 'medium', 'high'],
      permissionModes: ['ask', 'approve', 'bypass'],
    };
    return context.json({ sessionId: context.req.param('id'), config, options });
  });

  app.get('/api/sessions/:id/context', (context) => {
    const usage: ContextUsage = { usedTokens: 0, maxTokens: 0, percentage: 0, breakdown: [] };
    return context.json({ sessionId: context.req.param('id'), usage });
  });

  app.get('/api/sessions/:id/cost', (context) => {
    const cost: CostSummary = {
      sessionCost: 0,
      formattedCost: '$0.00',
      inputTokens: 0,
      outputTokens: 0,
      apiCalls: 0,
      sessionDuration: 0,
    };
    return context.json({ sessionId: context.req.param('id'), cost });
  });

  return app;
}

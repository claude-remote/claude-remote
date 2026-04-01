import { Hono } from 'hono';

import type { SessionStatus } from '@/shared/types';
import { Hub } from '@/hub/Hub';

interface HealthPayload {
  status: 'ok' | 'degraded';
  uptime: number;
  sessions: Record<SessionStatus | 'total', number>;
}

export function registerHealthRoutes(app: Hono, _hub: Hub): Hono {
  // TODO(T06,T30): wire real health, memory, tunnel, tool queue, and client counts.
  app.get('/api/health', (context) => {
    const payload: HealthPayload = {
      status: 'ok',
      uptime: 0,
      sessions: { active: 0, idle: 0, interrupted: 0, archived: 0, total: 0 },
    };
    return context.json(payload);
  });

  return app;
}

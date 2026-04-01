import type { Hono } from 'hono';

import { CLAUDE_REMOTE_VERSION } from '@/shared/constants';
import type { SessionStatus } from '@/shared/types';
import type { Hub } from '@/hub/Hub';

interface HealthPayload {
  status: 'ok' | 'degraded';
  version: string;
  uptime: number;
  sessions: Record<SessionStatus | 'total', number>;
  connections: number;
}

const startedAt = Date.now();

export function registerHealthRoutes(app: Hono, hub: Hub): Hono {
  app.get('/api/health', (context) => {
    const hubStatus = hub.getStatus();

    const payload: HealthPayload = {
      status: 'ok',
      version: CLAUDE_REMOTE_VERSION,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      sessions: {
        active: hubStatus.sessionCount, // TODO(T30): break down by status
        idle: 0,
        interrupted: 0,
        archived: 0,
        total: hubStatus.sessionCount,
      },
      connections: hubStatus.connectionCount,
    };

    return context.json(payload);
  });

  return app;
}

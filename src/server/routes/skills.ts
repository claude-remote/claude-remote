import { Hono } from 'hono';

import type { SkillInfo } from '@/shared/types';
import { Hub } from '@/hub/Hub';

export function registerSkillRoutes(app: Hono, _hub: Hub): Hono {
  // TODO(T06,T18): expose skill discovery and invocation bridges for the Web client.
  app.get('/api/sessions/:id/skills', (context) => {
    const skills: SkillInfo[] = [];
    return context.json({ sessionId: context.req.param('id'), skills });
  });

  return app;
}

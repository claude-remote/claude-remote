import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';
import type { SkillInfo } from '@/shared/types';

export function registerSkillRoutes(app: Hono, _hub: Hub): Hono {
  // GET /api/sessions/:id/skills — list available skills for a session
  app.get('/api/sessions/:id/skills', (context) => {
    const sessionId = context.req.param('id');

    // TODO(T18): expose skill discovery from Hub's skill registry
    const skills: SkillInfo[] = [];
    return context.json({ sessionId, skills });
  });

  // GET /api/skills — list all globally available skills
  app.get('/api/skills', (_context) => {
    // TODO(T18): expose global skill registry
    const skills: SkillInfo[] = [];
    return _context.json({ skills });
  });

  // POST /api/skills/invoke — invoke a skill { name, args? }
  app.post('/api/skills/invoke', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      name?: string;
      args?: string;
      sessionId?: string;
    };

    if (!body.name || typeof body.name !== 'string') {
      return context.json({ error: 'Skill name required' }, 400);
    }

    // TODO(T18): wire to hub skill invocation engine
    return context.json({
      ok: true,
      skill: body.name,
      args: body.args ?? null,
      sessionId: body.sessionId ?? null,
      status: 'queued',
    });
  });

  return app;
}

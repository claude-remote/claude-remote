import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';

export function registerSkillRoutes(app: Hono, hub: Hub): Hono {
  // GET /api/sessions/:id/skills — list available skills for a session
  app.get('/api/sessions/:id/skills', (context) => {
    const sessionId = context.req.param('id');
    const skills = hub.getSessionSkills(sessionId);
    if (!skills) {
      return context.json({ error: `session ${sessionId} not found` }, 404);
    }

    return context.json({ sessionId, skills });
  });

  // GET /api/skills — list all globally available skills
  app.get('/api/skills', (context) => {
    return context.json({ skills: hub.listSkills() });
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

    const result = hub.invokeSkill(body.name, body.args, body.sessionId);
    if (result === null) {
      return context.json({ error: `skill ${body.name} not found` }, 404);
    }
    if (result === undefined) {
      return context.json({ error: `session ${body.sessionId} not found` }, 404);
    }

    return context.json(result);
  });

  return app;
}

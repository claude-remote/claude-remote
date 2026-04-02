import type { Hono } from 'hono';

import type { SessionMeta, SessionSnapshot, SessionConfig, ConfigOptions, ContextUsage, CostSummary } from '@/shared/types';
import type { Hub } from '@/hub/Hub';

export function registerSessionRoutes(app: Hono, hub: Hub): Hono {
  // GET /api/sessions — list sessions (optional query: ?status=active)
  app.get('/api/sessions', (context) => {
    const statusFilter = context.req.query('status');
    let sessions: SessionMeta[] = hub.listSessions().map((s) => ({
      id: s.id,
      name: s.name,
      cwd: s.cwd,
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      clientCount: s.clients?.length ?? 0,
      hasActiveWriter:
        s.clients?.some(
          (c) =>
            (c as { writerStatus?: string | null }).writerStatus === 'active',
        ) ?? false,
    }));

    if (statusFilter) {
      sessions = sessions.filter((s) => s.status === statusFilter);
    }

    return context.json({ sessions });
  });

  // POST /api/sessions — create session { name?, cwd? }
  app.post('/api/sessions', async (context) => {
    const body = await context.req.json().catch(() => ({})) as { name?: string; cwd?: string };
    const cwd = body.cwd ?? process.cwd();
    const name = body.name;

    // TODO(T03): wire to hub.createSession() once available
    const session: SessionMeta = {
      id: crypto.randomUUID(),
      name: name ?? 'Untitled session',
      cwd,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      clientCount: 0,
      hasActiveWriter: false,
    };

    return context.json({ session }, 201);
  });

  // GET /api/sessions/:id — get session detail + snapshot
  app.get('/api/sessions/:id', (context) => {
    const sessionId = context.req.param('id');

    // TODO(T03): wire to hub.getSessionSnapshot()
    const snapshot: SessionSnapshot | null = null;
    if (!snapshot) {
      return context.json({ error: 'Session not found' }, 404);
    }

    return context.json({ sessionId, snapshot });
  });

  // POST /api/sessions/:id/archive — archive session
  app.post('/api/sessions/:id/archive', (context) => {
    const sessionId = context.req.param('id');

    // TODO(T03): wire to hub.archiveSession()
    return context.json({ ok: true, sessionId, status: 'archived' });
  });

  // PATCH /api/sessions/:id — update session (rename, tags, config)
  app.patch('/api/sessions/:id', async (context) => {
    const sessionId = context.req.param('id');
    const body = await context.req.json().catch(() => ({})) as {
      name?: string;
      tags?: string[];
      config?: Partial<SessionConfig>;
    };

    // TODO(T03): wire to hub.updateSession()
    return context.json({ ok: true, sessionId, updated: body });
  });

  // GET /api/sessions/:id/messages — paginated message history
  app.get('/api/sessions/:id/messages', (context) => {
    const sessionId = context.req.param('id');
    const offset = parseInt(context.req.query('offset') ?? '0', 10);
    const limit = parseInt(context.req.query('limit') ?? '50', 10);

    // TODO(T03): wire to hub.getSessionMessages()
    return context.json({ sessionId, messages: [], offset, limit, total: 0 });
  });

  // POST /api/sessions/:id/chat — send message (SSE streaming)
  app.post('/api/sessions/:id/chat', async (context) => {
    const sessionId = context.req.param('id');
    const body = await context.req.json().catch(() => ({})) as { message?: string };

    if (!body.message || typeof body.message !== 'string') {
      return context.json({ error: 'Message required' }, 400);
    }

    // TODO(T03,T07): wire to hub chat engine with SSE streaming
    return context.json({ sessionId, status: 'queued', message: body.message });
  });

  // GET /api/sessions/:id/export — export conversation
  app.get('/api/sessions/:id/export', (context) => {
    const sessionId = context.req.param('id');
    const format = context.req.query('format') ?? 'markdown';

    // TODO(T03): wire to hub.exportSession()
    return context.json({
      sessionId,
      content: '',
      format,
      filename: `session-${sessionId}.${format === 'json' ? 'json' : 'md'}`,
    });
  });

  return app;
}

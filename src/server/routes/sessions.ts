import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';
import type {
  ConfigOptions,
  ContextUsage,
  CostSummary,
  SessionConfig,
  SessionMeta,
  SessionSnapshot,
} from '@/shared/types';

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
        s.clients?.some((c) => (c as { writerStatus?: string | null }).writerStatus === 'active') ??
        false,
    }));

    if (statusFilter) {
      sessions = sessions.filter((s) => s.status === statusFilter);
    }

    return context.json({ sessions });
  });

  // POST /api/sessions — create session { name?, cwd? }
  app.post('/api/sessions', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { name?: string; cwd?: string };
    const cwd = body.cwd ?? process.cwd();
    const name = body.name;

    const created = hub.createSession({ cwd, name });
    const session: SessionMeta = {
      id: created.id,
      name: created.name,
      cwd: created.cwd,
      status: created.status,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      clientCount: created.clients.length,
      hasActiveWriter: created.clients.length > 0,
      tags: created.tags ?? [],
    };

    return context.json({ session }, 201);
  });

  // GET /api/sessions/:id — get session detail + snapshot
  app.get('/api/sessions/:id', (context) => {
    const sessionId = context.req.param('id');

    const snapshot: SessionSnapshot | null = hub.getSessionSnapshot(sessionId);
    if (!snapshot) {
      return context.json({ error: 'Session not found' }, 404);
    }

    return context.json({ sessionId, snapshot });
  });

  // POST /api/sessions/:id/archive — archive session
  app.post('/api/sessions/:id/archive', (context) => {
    const sessionId = context.req.param('id');

    const session = hub.archiveSession(sessionId);
    if (!session) {
      return context.json({ error: 'Session not found' }, 404);
    }
    return context.json({ ok: true, sessionId, status: 'archived' });
  });

  // PATCH /api/sessions/:id — update session (rename, tags, config)
  app.patch('/api/sessions/:id', async (context) => {
    const sessionId = context.req.param('id');
    const body = (await context.req.json().catch(() => ({}))) as {
      name?: string;
      tags?: string[];
      config?: Partial<SessionConfig>;
    };

    const session = hub.updateSession(sessionId, {
      name: body.name,
      tags: body.tags,
    });
    if (!session) {
      return context.json({ error: 'Session not found' }, 404);
    }
    return context.json({ ok: true, sessionId, updated: body });
  });

  // GET /api/sessions/:id/messages — paginated message history
  app.get('/api/sessions/:id/messages', (context) => {
    const sessionId = context.req.param('id');
    const offset = Number.parseInt(context.req.query('offset') ?? '0', 10);
    const limit = Number.parseInt(context.req.query('limit') ?? '50', 10);

    const session = hub.getSession(sessionId);
    if (!session) {
      return context.json({ error: 'Session not found' }, 404);
    }

    const messages = session.messages.slice(offset, offset + limit);
    return context.json({ sessionId, messages, offset, limit, total: session.messages.length });
  });

  // POST /api/sessions/:id/chat — send message (SSE streaming)
  app.post('/api/sessions/:id/chat', async (context) => {
    const sessionId = context.req.param('id');
    const body = (await context.req.json().catch(() => ({}))) as { message?: string };

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

    const session = hub.getSession(sessionId);
    if (!session) {
      return context.json({ error: 'Session not found' }, 404);
    }

    const filename = `session-${sessionId}.${format === 'json' ? 'json' : 'md'}`;
    const content =
      format === 'json'
        ? JSON.stringify(session, null, 2)
        : [
            `# ${session.name}`,
            '',
            `- Session ID: ${session.id}`,
            `- CWD: ${session.cwd}`,
            `- Status: ${session.status}`,
            '',
            ...session.messages.flatMap((message) => [
              `## ${message.role} @ ${new Date(message.createdAt).toISOString()}`,
              '',
              ...message.content.map((block) => {
                if (block.type === 'text') {
                  return `**${message.role}**: ${block.text}`;
                }
                return `**${message.role}**: [${block.type}]`;
              }),
              '',
            ]),
          ].join('\n');

    return context.json({
      sessionId,
      content,
      format,
      filename,
    });
  });

  return app;
}

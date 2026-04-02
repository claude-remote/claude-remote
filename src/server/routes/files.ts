import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  modifiedAt?: number;
}

interface FileContent {
  path: string;
  content: string;
  totalLines: number;
  offset: number;
  limit: number;
}

export function registerFileRoutes(app: Hono, _hub: Hub): Hono {
  // GET /api/files/list?path=xxx — list directory contents
  app.get('/api/files/list', (context) => {
    const dirPath = context.req.query('path');
    if (!dirPath) {
      return context.json({ error: 'path query parameter required' }, 400);
    }

    // TODO(T17): implement whitelisted directory listing with security checks
    const entries: FileEntry[] = [];
    return context.json({ path: dirPath, entries });
  });

  // GET /api/files/read?path=xxx — read file content (with pagination)
  app.get('/api/files/read', (context) => {
    const filePath = context.req.query('path');
    if (!filePath) {
      return context.json({ error: 'path query parameter required' }, 400);
    }

    const offset = Number.parseInt(context.req.query('offset') ?? '0', 10);
    const limit = Number.parseInt(context.req.query('limit') ?? '200', 10);

    // TODO(T17): implement whitelisted file reading with security checks
    const result: FileContent = {
      path: filePath,
      content: '',
      totalLines: 0,
      offset,
      limit,
    };

    return context.json(result);
  });

  // GET /api/files — legacy endpoint (backward compat)
  app.get('/api/files', (context) => {
    const sessionId = context.req.query('sessionId') ?? 'unknown';
    return context.json({ session: { id: sessionId }, entries: [] });
  });

  return app;
}

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
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
  size: number;
  modified: string;
}

export function registerFileRoutes(app: Hono, _hub: Hub): Hono {
  // GET /api/files/list?path=xxx — list directory contents
  app.get('/api/files/list', (context) => {
    const dirPath = context.req.query('path');
    if (!dirPath) {
      return context.json({ error: 'path query parameter required' }, 400);
    }

    try {
      const entries: FileEntry[] = readdirSync(dirPath, { withFileTypes: true })
        .map((entry) => {
          const path = join(dirPath, entry.name);
          const stats = statSync(path);
          return {
            name: entry.name,
            path,
            type: entry.isDirectory()
              ? 'directory'
              : entry.isSymbolicLink()
                ? 'symlink'
                : 'file',
            size: entry.isDirectory() ? undefined : stats.size,
            modifiedAt: stats.mtimeMs,
          } satisfies FileEntry;
        })
        .sort((a, b) => {
          if (a.type === b.type) {
            return a.name.localeCompare(b.name);
          }
          return a.type === 'directory' ? -1 : 1;
        });
      return context.json({ path: dirPath, entries });
    } catch (error) {
      return context.json({ error: (error as Error).message }, 404);
    }
  });

  // GET /api/files/read?path=xxx — read file content (with pagination)
  app.get('/api/files/read', (context) => {
    const filePath = context.req.query('path');
    if (!filePath) {
      return context.json({ error: 'path query parameter required' }, 400);
    }

    const offset = Number.parseInt(context.req.query('offset') ?? '0', 10);
    const limit = Number.parseInt(context.req.query('limit') ?? '200', 10);

    try {
      const content = readFileSync(filePath, 'utf8');
      const stats = statSync(filePath);
      const lines = content.replace(/\n$/, '').split('\n');
      const pagedLines = lines.slice(offset, offset + limit);
      const result: FileContent = {
        path: filePath,
        content: pagedLines.join('\n'),
        totalLines: lines.filter((line) => line.length > 0 || lines.length === 1).length,
        offset,
        limit,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };

      return context.json(result);
    } catch (error) {
      return context.json({ error: (error as Error).message }, 404);
    }
  });

  // GET /api/files/browse?path=xxx — list directories only for path picker
  app.get('/api/files/browse', (context) => {
    const dirPath = context.req.query('path');
    if (!dirPath) {
      return context.json({ error: 'path query parameter required' }, 400);
    }

    try {
      const dirs = readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dirPath, entry.name))
        .sort((a, b) => basename(a).localeCompare(basename(b)));
      return context.json({ path: dirPath, dirs });
    } catch (error) {
      return context.json({ error: (error as Error).message }, 404);
    }
  });

  // GET /api/files — legacy endpoint (backward compat)
  app.get('/api/files', (context) => {
    const sessionId = context.req.query('sessionId') ?? 'unknown';
    return context.json({ session: { id: sessionId }, entries: [] });
  });

  return app;
}

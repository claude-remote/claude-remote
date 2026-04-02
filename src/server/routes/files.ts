import { readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';
import { listEntries } from '@/server/files/listEntries';
import { validatePath } from '@/server/files/pathValidator';
import { readFileContent } from '@/server/files/readFileContent';

const SENSITIVE_DOTFILE_NAMES = new Set([
  '.aws',
  '.docker',
  '.env',
  '.gnupg',
  '.kube',
  '.npm',
  '.ssh',
]);

function getHttpAllowedRoots(): string[] {
  return [
    homedir(),
    tmpdir(),
    // TODO: replace these fallback roots with an auth-context session cwd once routes have session context.
  ];
}

function isSensitivePath(resolvedPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (resolvedPath !== root && !resolvedPath.startsWith(prefix)) {
      return false;
    }

    const relativePath = resolvedPath.slice(prefix.length);
    return relativePath
      .split('/')
      .filter(Boolean)
      .some((segment) => SENSITIVE_DOTFILE_NAMES.has(segment));
  });
}

function resolveRoutePath(requestedPath: string): string {
  const allowedRoots = getHttpAllowedRoots();
  const safePath = validatePath(requestedPath, allowedRoots);

  if (isSensitivePath(safePath, allowedRoots)) {
    throw new Error('path not allowed: sensitive path');
  }

  return safePath;
}

function getRouteErrorStatus(error: Error): number {
  return error.message.startsWith('path not allowed:') ? 403 : 404;
}

export function registerFileRoutes(app: Hono, hub: Hub): Hono {
  // GET /api/files/list?path=xxx — list directory contents
  app.get('/api/files/list', (context) => {
    const dirPath = context.req.query('path');
    if (!dirPath) {
      return context.json({ error: 'path query parameter required' }, 400);
    }

    try {
      const safePath = resolveRoutePath(dirPath);
      return context.json({ path: safePath, entries: listEntries(safePath) });
    } catch (error) {
      return context.json({ error: (error as Error).message }, getRouteErrorStatus(error as Error));
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
      const safePath = resolveRoutePath(filePath);
      return context.json(readFileContent(safePath, offset, limit));
    } catch (error) {
      return context.json({ error: (error as Error).message }, getRouteErrorStatus(error as Error));
    }
  });

  // GET /api/files/browse?path=xxx — list directories only for path picker
  app.get('/api/files/browse', (context) => {
    const dirPath = context.req.query('path');
    if (!dirPath) {
      return context.json({ error: 'path query parameter required' }, 400);
    }

    try {
      const safePath = resolveRoutePath(dirPath);
      const dirs = readdirSync(safePath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(safePath, entry.name))
        .sort((a, b) => basename(a).localeCompare(basename(b)));
      return context.json({ path: safePath, dirs });
    } catch (error) {
      return context.json({ error: (error as Error).message }, getRouteErrorStatus(error as Error));
    }
  });

  // GET /api/files — legacy endpoint (backward compat)
  app.get('/api/files', (context) => {
    const sessionId = context.req.query('sessionId');
    if (!sessionId) {
      return context.json({ error: 'sessionId query parameter required' }, 400);
    }

    const session = hub.getSession(sessionId);
    if (!session) {
      return context.json({ error: `session ${sessionId} not found` }, 404);
    }

    try {
      return context.json({
        session: { id: sessionId },
        path: session.cwd,
        entries: listEntries(session.cwd),
      });
    } catch (error) {
      return context.json({ error: (error as Error).message }, 404);
    }
  });

  return app;
}

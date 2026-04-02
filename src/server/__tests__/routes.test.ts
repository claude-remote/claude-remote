import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

import { TokenService } from '@/server/auth/token';
import { registerAuthRoutes } from '@/server/routes/auth';
import { registerConfigRoutes } from '@/server/routes/config';
import { registerFileRoutes } from '@/server/routes/files';
import { registerHealthRoutes } from '@/server/routes/health';
import { registerHistoryRoutes } from '@/server/routes/history';
import { registerMcpRoutes } from '@/server/routes/mcp';
import { registerSessionRoutes } from '@/server/routes/sessions';
import { registerSkillRoutes } from '@/server/routes/skills';
import { CLAUDE_REMOTE_VERSION } from '@/shared/constants';

// Minimal Hub stub for testing routes
function createMockHub() {
  return {
    getStatus() {
      return { running: true, sessionCount: 2, connectionCount: 3, socketPath: '/tmp/test.sock' };
    },
    listSessions() {
      return [
        {
          id: 'sess-1',
          name: 'Test Session',
          cwd: '/tmp/test',
          createdAt: 1000,
          updatedAt: 2000,
          status: 'active' as const,
          clients: [
            { id: 'c1', type: 'web' as const, writerStatus: 'active' as const, connectedAt: 1000 },
          ],
          messages: [],
          tasks: [],
        },
        {
          id: 'sess-2',
          name: 'Idle Session',
          cwd: '/tmp/idle',
          createdAt: 500,
          updatedAt: 1500,
          status: 'idle' as const,
          clients: [],
          messages: [],
          tasks: [],
        },
      ];
    },
  } as any;
}

function createTestApp() {
  const app = new Hono();
  const hub = createMockHub();
  const tokenService = new TokenService();

  registerHealthRoutes(app, hub);
  registerAuthRoutes(app, tokenService);
  registerSessionRoutes(app, hub);
  registerFileRoutes(app, hub);
  registerSkillRoutes(app, hub);
  registerConfigRoutes(app, hub);
  registerMcpRoutes(app, hub);
  registerHistoryRoutes(app, hub);

  return { app, tokenService };
}

describe('health routes', () => {
  test('GET /api/health returns correct shape', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe(CLAUDE_REMOTE_VERSION);
    expect(typeof body.uptime).toBe('number');
    expect(body.sessions).toBeDefined();
    expect(typeof body.sessions.total).toBe('number');
    expect(typeof body.connections).toBe('number');
  });
});

describe('auth routes', () => {
  test('POST /api/auth/login with valid token returns ok', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'test-master-token' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sessionToken).toBeDefined();
  });

  test('POST /api/auth/login without token returns 401', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test('POST /api/auth/bootstrap with valid token succeeds', async () => {
    const { app, tokenService } = createTestApp();
    const bootstrap = tokenService.issueBootstrapToken();

    const res = await app.request('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: bootstrap.token }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sessionToken).toBeDefined();
  });

  test('POST /api/auth/bootstrap with invalid token returns 401', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-token' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

describe('session routes', () => {
  test('GET /api/sessions returns session list', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions.length).toBe(2);
    expect(body.sessions[0].id).toBe('sess-1');
    expect(body.sessions[0].name).toBe('Test Session');
    expect(body.sessions[0].clientCount).toBe(1);
    expect(body.sessions[0].hasActiveWriter).toBe(true);
  });

  test('GET /api/sessions?status=active filters by status', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions?status=active');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.length).toBe(1);
    expect(body.sessions[0].status).toBe('active');
  });

  test('POST /api/sessions creates a session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Session', cwd: '/tmp/new' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session.name).toBe('New Session');
    expect(body.session.cwd).toBe('/tmp/new');
    expect(body.session.status).toBe('active');
  });

  test('GET /api/sessions/:id returns 404 for nonexistent session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/nonexistent');

    expect(res.status).toBe(404);
  });

  test('POST /api/sessions/:id/archive returns ok', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/archive', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('archived');
  });

  test('PATCH /api/sessions/:id updates session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updated.name).toBe('Renamed');
  });
});

describe('file routes', () => {
  test('GET /api/files/list without path returns 400', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/files/list');

    expect(res.status).toBe(400);
  });

  test('GET /api/files/list with path returns entries', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/files/list?path=/tmp');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe('/tmp');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  test('GET /api/files/read without path returns 400', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/files/read');

    expect(res.status).toBe(400);
  });

  test('GET /api/files/read with path returns content', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/files/read?path=/tmp/test.txt');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe('/tmp/test.txt');
    expect(typeof body.content).toBe('string');
  });
});

describe('skill routes', () => {
  test('GET /api/skills returns empty skills list', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.skills)).toBe(true);
  });

  test('POST /api/skills/invoke without name returns 400', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/skills/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test('POST /api/skills/invoke with name returns queued', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/skills/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'commit', args: '-m "test"' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skill).toBe('commit');
    expect(body.status).toBe('queued');
  });
});

describe('config routes', () => {
  test('GET /api/sessions/:id/config returns config and options', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/config');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toBeDefined();
    expect(body.config.model).toBeDefined();
    expect(body.options).toBeDefined();
    expect(Array.isArray(body.options.effortLevels)).toBe(true);
  });

  test('GET /api/sessions/:id/context returns usage', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/context');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage).toBeDefined();
    expect(typeof body.usage.percentage).toBe('number');
  });

  test('GET /api/sessions/:id/cost returns cost summary', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/cost');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cost).toBeDefined();
    expect(typeof body.cost.sessionCost).toBe('number');
    expect(typeof body.cost.formattedCost).toBe('string');
  });

  test('GET /api/config returns global config', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/config');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.port).toBe('number');
  });
});

describe('mcp routes', () => {
  test('GET /api/mcp/servers returns server list', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/mcp/servers');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.servers)).toBe(true);
  });

  test('POST /api/mcp/servers/:name/reconnect returns ok', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/mcp/servers/test-server/reconnect', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('reconnecting');
  });
});

describe('history routes', () => {
  test('GET /api/history/search without query returns 400', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/history/search');

    expect(res.status).toBe(400);
  });

  test('GET /api/history/search with query returns results', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/history/search?q=test&scope=all');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toBe('test');
    expect(body.scope).toBe('all');
    expect(Array.isArray(body.results)).toBe(true);
  });
});

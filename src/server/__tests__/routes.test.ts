import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { CLAUDE_REMOTE_VERSION, SESSION_COOKIE_NAME } from '@/shared/constants';
import type { McpServerInfo, Message, SessionConfig, SkillInfo } from '@/shared/types';

type MockRouteSession = {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'idle' | 'archived';
  clients: Array<{
    id: string;
    type: 'web';
    writerStatus: 'active' | 'standby';
    connectedAt: number;
  }>;
  messages: Message[];
  tasks: unknown[];
  pendingPermissions: unknown[];
  tags: string[];
};

// Minimal Hub stub for testing routes
function createMockHub() {
  const sessions: MockRouteSession[] = [
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
      messages: [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'hello' }],
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'hi there' }],
          createdAt: 1001,
          updatedAt: 1001,
        },
      ],
      tasks: [],
      pendingPermissions: [],
      tags: [],
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
      pendingPermissions: [],
      tags: [],
    },
  ];
  const sessionConfigs = new Map<string, SessionConfig>([
    [
      'sess-1',
      {
        model: 'claude-sonnet',
        effortLevel: 'medium' as const,
        permissionMode: 'ask' as const,
      },
    ],
    [
      'sess-2',
      {
        model: 'claude-haiku',
        effortLevel: 'low' as const,
        permissionMode: 'approve' as const,
      },
    ],
  ]);
  let globalConfig = {
    port: 7680,
    tunnel: false,
    maxSessions: 10,
    maxConcurrentTools: 5,
  };
  const mcpServers = new Map<string, McpServerInfo>([
    [
      'test-server',
      {
        id: 'mcp-1',
        name: 'test-server',
        type: 'stdio',
        status: 'connected',
        enabled: true,
        toolCount: 2,
        tools: [{ name: 'search', description: 'Search docs' }],
      },
    ],
  ]);
  const skills: SkillInfo[] = [
    {
      name: 'commit',
      description: 'Create a git commit from staged changes',
      aliases: ['ci'],
      userInvocable: true,
      arguments: ['message'],
      source: 'bundled',
    },
    {
      name: 'review',
      description: 'Review the current diff for bugs and risks',
      userInvocable: true,
      source: 'bundled',
    },
  ];

  const buildSnapshot = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      return null;
    }

    return {
      meta: {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        clientCount: session.clients.length,
        hasActiveWriter: session.clients.some((client) => client.writerStatus === 'active'),
        tags: session.tags,
      },
      recentMessages: session.messages,
      activeTasks: session.tasks,
      pendingPermissions: session.pendingPermissions,
      clients: session.clients,
      availableSkills: skills,
      config: sessionConfigs.get(session.id) ?? {
        model: 'claude-sonnet',
        effortLevel: 'medium' as const,
        permissionMode: 'ask' as const,
      },
      configOptions: {
        availableModels: [
          { id: 'claude-sonnet', name: 'Claude Sonnet', supportsImages: true },
          { id: 'claude-haiku', name: 'Claude Haiku', supportsImages: true },
        ],
        effortLevels: ['low', 'medium', 'high'] as const,
        permissionModes: ['ask', 'approve', 'bypass'] as const,
      },
      contextUsage: { usedTokens: 0, maxTokens: 200000, percentage: 0, breakdown: [] },
      costSummary: {
        sessionCost: 0,
        formattedCost: '$0.00',
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        sessionDuration: 0,
      },
      mcpServers: [],
      myWriterStatus: 'active' as const,
      lastSeq: 0,
    };
  };

  return {
    getStatus() {
      return { running: true, sessionCount: 2, connectionCount: 3, socketPath: '/tmp/test.sock' };
    },
    getGlobalConfig() {
      return globalConfig;
    },
    updateGlobalConfig(updates: Record<string, unknown>) {
      globalConfig = {
        ...globalConfig,
        ...updates,
      };
      return globalConfig;
    },
    listSkills() {
      return skills;
    },
    getSessionSkills(sessionId: string) {
      if (!sessions.some((item) => item.id === sessionId)) {
        return null;
      }
      return skills;
    },
    invokeSkill(name: string, args?: string, sessionId?: string) {
      const skill = skills.find((item) => item.name === name || item.aliases?.includes(name));
      if (!skill) {
        return null;
      }
      if (sessionId && !sessions.some((item) => item.id === sessionId)) {
        return undefined;
      }
      return {
        ok: true,
        skill: skill.name,
        args: args ?? null,
        sessionId: sessionId ?? null,
        status: 'queued' as const,
      };
    },
    listMcpServers() {
      return Array.from(mcpServers.values());
    },
    getMcpServer(name: string) {
      return mcpServers.get(name) ?? null;
    },
    reconnectMcpServer(name: string) {
      const server = mcpServers.get(name);
      if (!server) {
        return null;
      }
      const updated = {
        ...server,
        status: 'connected' as const,
      };
      mcpServers.set(name, updated);
      return updated;
    },
    toggleMcpServer(name: string, enabled: boolean) {
      const server = mcpServers.get(name);
      if (!server) {
        return null;
      }
      const updated = {
        ...server,
        enabled,
        status: enabled ? 'connected' : 'disconnected',
      } satisfies McpServerInfo;
      mcpServers.set(name, updated);
      return updated;
    },
    listSessions() {
      return sessions;
    },
    createSession(input: { cwd: string; name?: string }) {
      const session = {
        id: `sess-${sessions.length + 1}`,
        name: input.name ?? 'Untitled session',
        cwd: input.cwd,
        createdAt: 3000,
        updatedAt: 3000,
        status: 'active' as const,
        clients: [],
        messages: [],
        tasks: [],
        pendingPermissions: [],
        tags: [],
      };
      sessions.unshift(session);
      sessionConfigs.set(session.id, {
        model: 'claude-sonnet',
        effortLevel: 'medium',
        permissionMode: 'ask',
      });
      return session;
    },
    getSessionSnapshot(sessionId: string) {
      return buildSnapshot(sessionId);
    },
    getSession(sessionId: string) {
      return sessions.find((item) => item.id === sessionId) ?? null;
    },
    setSessionCwd(sessionId: string, cwd: string) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        return null;
      }
      session.cwd = cwd;
      session.updatedAt = 4600;
      return session;
    },
    updateSessionConfig(
      sessionId: string,
      updates: Partial<SessionConfig>,
    ) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        return null;
      }

      const current = sessionConfigs.get(sessionId) ?? {
        model: 'claude-sonnet',
        effortLevel: 'medium' as const,
        permissionMode: 'ask' as const,
      };
      const updated = {
        ...current,
        ...updates,
      };
      sessionConfigs.set(sessionId, updated);
      session.updatedAt = 4500;
      return updated;
    },
    appendMessage(sessionId: string, message: MockRouteSession['messages'][number]) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        return null;
      }
      session.messages.push(message);
      session.updatedAt = Math.max(session.updatedAt, message.updatedAt);
      return session;
    },
    archiveSession(sessionId: string) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        return null;
      }
      session.status = 'archived';
      session.updatedAt = 4000;
      return session;
    },
    updateSession(
      sessionId: string,
      updates: { name?: string; tags?: string[]; config?: Record<string, unknown> },
    ) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        return null;
      }
      if (updates.name !== undefined) {
        session.name = updates.name;
      }
      if (updates.tags !== undefined) {
        session.tags = updates.tags;
      }
      session.updatedAt = 5000;
      return {
        session,
        updated: updates,
      };
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

  return { app, hub, tokenService };
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
    const { app, tokenService } = createTestApp();
    const masterToken = await tokenService.loadOrCreateMasterToken();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: masterToken }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sessionToken).toBeDefined();
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=`);
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

  test('POST /api/auth/login with invalid token returns 401', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-token' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid token');
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
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=`);
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

    const listRes = await app.request('/api/sessions');
    const listBody = await listRes.json();
    expect(listBody.sessions[0].name).toBe('New Session');
  });

  test('GET /api/sessions/:id returns snapshot for existing session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-1');
    expect(body.snapshot.meta.id).toBe('sess-1');
    expect(body.snapshot.meta.name).toBe('Test Session');
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

    const detailRes = await app.request('/api/sessions/sess-1');
    const detailBody = await detailRes.json();
    expect(detailBody.snapshot.meta.status).toBe('archived');
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

    const detailRes = await app.request('/api/sessions/sess-1');
    const detailBody = await detailRes.json();
    expect(detailBody.snapshot.meta.name).toBe('Renamed');
  });

  test('GET /api/sessions/:id/messages returns paginated history', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/messages?offset=1&limit=1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-1');
    expect(body.total).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].id).toBe('msg-2');
  });

  test('GET /api/sessions/:id/export returns markdown transcript', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/export?format=markdown');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-1');
    expect(body.format).toBe('markdown');
    expect(body.filename).toBe('session-sess-1.md');
    expect(body.content).toContain('# Test Session');
    expect(body.content).toContain('**user**');
    expect(body.content).toContain('hello');
    expect(body.content).toContain('**assistant**');
  });

  test('POST /api/sessions/:id/chat persists a user message and returns queued', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'ship it' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-1');
    expect(body.status).toBe('queued');
    expect(body.messageId).toBeTruthy();

    const historyRes = await app.request('/api/sessions/sess-1/messages');
    const historyBody = await historyRes.json();
    expect(historyBody.total).toBe(3);
    expect(historyBody.messages[2].role).toBe('user');
    expect(historyBody.messages[2].content[0].text).toBe('ship it');
  });

  test('POST /api/sessions/:id/chat returns 404 for missing session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/missing/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('file routes', () => {
  test('GET /api/files/list without path returns 400', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/files/list');

    expect(res.status).toBe(400);
  });

  test('GET /api/files/list with path returns entries', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-remote-files-'));
    mkdirSync(join(fixtureDir, 'nested'));
    writeFileSync(join(fixtureDir, 'note.txt'), 'hello\nworld\n');

    const { app } = createTestApp();
    const res = await app.request(`/api/files/list?path=${encodeURIComponent(fixtureDir)}`);

    try {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.path).toBe(fixtureDir);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries).toHaveLength(2);
      expect(body.entries[0].name).toBe('nested');
      expect(body.entries[0].type).toBe('directory');
      expect(body.entries[1].name).toBe('note.txt');
      expect(body.entries[1].type).toBe('file');
      expect(typeof body.entries[1].size).toBe('number');
      expect(typeof body.entries[1].modifiedAt).toBe('number');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('GET /api/files/read without path returns 400', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/files/read');

    expect(res.status).toBe(400);
  });

  test('GET /api/files/read with path returns content', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-remote-file-read-'));
    const filePath = join(fixtureDir, 'test.txt');
    writeFileSync(filePath, 'line1\nline2\nline3\n');

    const { app } = createTestApp();
    const res = await app.request(
      `/api/files/read?path=${encodeURIComponent(filePath)}&offset=1&limit=1`,
    );

    try {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.path).toBe(filePath);
      expect(body.content).toBe('line2');
      expect(body.totalLines).toBe(4);
      expect(body.offset).toBe(1);
      expect(body.limit).toBe(1);
      expect(typeof body.size).toBe('number');
      expect(typeof body.modified).toBe('string');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('GET /api/files/browse returns matching directories', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-remote-file-browse-'));
    mkdirSync(join(fixtureDir, 'alpha'));
    mkdirSync(join(fixtureDir, 'beta'));
    writeFileSync(join(fixtureDir, 'ignore.txt'), 'x');

    const { app } = createTestApp();
    const res = await app.request(`/api/files/browse?path=${encodeURIComponent(fixtureDir)}`);

    try {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.path).toBe(fixtureDir);
      expect(body.dirs).toEqual([join(fixtureDir, 'alpha'), join(fixtureDir, 'beta')]);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('GET /api/files uses session cwd for legacy callers', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-remote-file-legacy-'));
    writeFileSync(join(fixtureDir, 'legacy.txt'), 'legacy');

    const { app, hub } = createTestApp();
    hub.setSessionCwd('sess-1', fixtureDir);
    const res = await app.request('/api/files?sessionId=sess-1');

    try {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.session.id).toBe('sess-1');
      expect(body.path).toBe(fixtureDir);
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].name).toBe('legacy.txt');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

describe('skill routes', () => {
  test('GET /api/skills returns available skills list', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.skills).toHaveLength(2);
    expect(body.skills[0].name).toBe('commit');
  });

  test('GET /api/sessions/:id/skills returns session skills', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/skills');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-1');
    expect(body.skills).toHaveLength(2);
  });

  test('GET /api/sessions/:id/skills returns 404 for missing session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/missing/skills');

    expect(res.status).toBe(404);
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

  test('POST /api/skills/invoke returns 404 for missing skill', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/skills/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'missing-skill' }),
    });

    expect(res.status).toBe(404);
  });

  test('POST /api/skills/invoke returns 404 for missing session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/skills/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'commit', sessionId: 'missing-session' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('config routes', () => {
  test('GET /api/sessions/:id/config returns config and options', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/config');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-1');
    expect(body.config).toBeDefined();
    expect(body.config.model).toBe('claude-sonnet');
    expect(body.options).toBeDefined();
    expect(Array.isArray(body.options.availableModels)).toBe(true);
    expect(Array.isArray(body.options.effortLevels)).toBe(true);
  });

  test('GET /api/sessions/:id/config returns 404 for missing session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/missing/config');

    expect(res.status).toBe(404);
  });

  test('PATCH /api/sessions/:id/config updates and persists config', async () => {
    const { app } = createTestApp();
    const updateRes = await app.request('/api/sessions/sess-1/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku', effortLevel: 'low' }),
    });

    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);
    expect(updateBody.updated.model).toBe('claude-haiku');
    expect(updateBody.updated.effortLevel).toBe('low');

    const getRes = await app.request('/api/sessions/sess-1/config');
    const getBody = await getRes.json();
    expect(getBody.config.model).toBe('claude-haiku');
    expect(getBody.config.effortLevel).toBe('low');
    expect(getBody.config.permissionMode).toBe('ask');
  });

  test('GET /api/sessions/:id/context returns usage', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/context');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-1');
    expect(body.usage).toBeDefined();
    expect(typeof body.usage.percentage).toBe('number');
  });

  test('GET /api/sessions/:id/context returns 404 for missing session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/missing/context');

    expect(res.status).toBe(404);
  });

  test('GET /api/sessions/:id/cost returns cost summary', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/sess-1/cost');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('sess-1');
    expect(body.cost).toBeDefined();
    expect(typeof body.cost.sessionCost).toBe('number');
    expect(typeof body.cost.formattedCost).toBe('string');
  });

  test('GET /api/sessions/:id/cost returns 404 for missing session', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sessions/missing/cost');

    expect(res.status).toBe(404);
  });

  test('GET /api/config returns global config', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/config');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.port).toBe(7680);
    expect(body.maxSessions).toBe(10);
  });

  test('PATCH /api/config updates and persists global config', async () => {
    const { app } = createTestApp();
    const updateRes = await app.request('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tunnel: true, maxConcurrentTools: 7 }),
    });

    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);
    expect(updateBody.updated.tunnel).toBe(true);
    expect(updateBody.updated.maxConcurrentTools).toBe(7);

    const getRes = await app.request('/api/config');
    const getBody = await getRes.json();
    expect(getBody.tunnel).toBe(true);
    expect(getBody.maxConcurrentTools).toBe(7);
  });
});

describe('mcp routes', () => {
  test('GET /api/mcp/servers returns server list', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/mcp/servers');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.servers)).toBe(true);
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0].name).toBe('test-server');
    expect(body.servers[0].status).toBe('connected');
  });

  test('GET /api/mcp/servers/:name returns server details', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/mcp/servers/test-server');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.server.name).toBe('test-server');
    expect(body.server.toolCount).toBe(2);
  });

  test('GET /api/mcp/servers/:name returns 404 for missing server', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/mcp/servers/missing');

    expect(res.status).toBe(404);
  });

  test('POST /api/mcp/servers/:name/reconnect returns ok', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/mcp/servers/test-server/reconnect', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.server.name).toBe('test-server');
    expect(body.server.status).toBe('connected');
  });

  test('POST /api/mcp/servers/:name/toggle updates enabled state', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/mcp/servers/test-server/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.server.enabled).toBe(false);
    expect(body.server.status).toBe('disconnected');
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
    const res = await app.request('/api/history/search?q=hello&scope=all');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toBe('hello');
    expect(body.scope).toBe('all');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].sessionId).toBe('sess-1');
    expect(body.results[0].messageId).toBe('msg-1');
    expect(body.results[0].role).toBe('user');
    expect(body.results[0].snippet).toContain('hello');
  });

  test('GET /api/history/search respects session filter and limit', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/history/search?q=h&scope=session&sessionId=sess-1&limit=1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe('session');
    expect(body.sessionId).toBe('sess-1');
    expect(body.limit).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].sessionId).toBe('sess-1');
  });
});

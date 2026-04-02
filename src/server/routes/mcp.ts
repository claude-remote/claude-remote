import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';

export function registerMcpRoutes(app: Hono, hub: Hub): Hono {
  // GET /api/mcp/servers — list all MCP servers (Hub-global, not session-level)
  app.get('/api/mcp/servers', (context) => {
    return context.json({ servers: hub.listMcpServers() });
  });

  // GET /api/mcp/servers/:name — get specific MCP server details
  app.get('/api/mcp/servers/:name', (context) => {
    const name = context.req.param('name');
    const server = hub.getMcpServer(name);
    if (!server) {
      return context.json({ error: `MCP server '${name}' not found` }, 404);
    }

    return context.json({ server });
  });

  // POST /api/mcp/servers/:name/reconnect — reconnect a specific MCP server
  app.post('/api/mcp/servers/:name/reconnect', (context) => {
    const name = context.req.param('name');
    const server = hub.reconnectMcpServer(name);
    if (!server) {
      return context.json({ error: `MCP server '${name}' not found` }, 404);
    }

    return context.json({ ok: true, server });
  });

  // POST /api/mcp/servers/:name/toggle — enable/disable a MCP server
  app.post('/api/mcp/servers/:name/toggle', async (context) => {
    const name = context.req.param('name');
    const body = (await context.req.json().catch(() => ({}))) as { enabled?: boolean };
    const server = hub.toggleMcpServer(name, body.enabled ?? true);
    if (!server) {
      return context.json({ error: `MCP server '${name}' not found` }, 404);
    }

    return context.json({ ok: true, server });
  });

  return app;
}

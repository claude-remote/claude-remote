import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';
import type { McpServerInfo } from '@/shared/types';

export function registerMcpRoutes(app: Hono, _hub: Hub): Hono {
  // GET /api/mcp/servers — list all MCP servers (Hub-global, not session-level)
  app.get('/api/mcp/servers', (_context) => {
    // TODO(T21): wire to hub MCP server registry
    const servers: McpServerInfo[] = [];
    return _context.json({ servers });
  });

  // GET /api/mcp/servers/:name — get specific MCP server details
  app.get('/api/mcp/servers/:name', (context) => {
    const name = context.req.param('name');

    // TODO(T21): wire to hub MCP server registry
    return context.json({ error: `MCP server '${name}' not found` }, 404);
  });

  // POST /api/mcp/servers/:name/reconnect — reconnect a specific MCP server
  app.post('/api/mcp/servers/:name/reconnect', (context) => {
    const name = context.req.param('name');

    // TODO(T21): wire to hub MCP server reconnection
    return context.json({ ok: true, server: name, status: 'reconnecting' });
  });

  // POST /api/mcp/servers/:name/toggle — enable/disable a MCP server
  app.post('/api/mcp/servers/:name/toggle', async (context) => {
    const name = context.req.param('name');
    const body = (await context.req.json().catch(() => ({}))) as { enabled?: boolean };

    // TODO(T21): wire to hub MCP server toggle
    return context.json({ ok: true, server: name, enabled: body.enabled ?? true });
  });

  return app;
}

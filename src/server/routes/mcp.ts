import { Hono } from 'hono';

import type { McpServerInfo } from '@/shared/types';
import { Hub } from '@/hub/Hub';

export function registerMcpRoutes(app: Hono, _hub: Hub): Hono {
  // TODO(T06,T21): expose Hub-global MCP server state and mutating actions.
  app.get('/api/mcp/servers', (context) => {
    const servers: McpServerInfo[] = [];
    return context.json({ servers });
  });

  return app;
}

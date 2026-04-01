import type { McpServerInfo } from '@/shared/types';

interface McpPanelProps {
  servers: McpServerInfo[];
}

export function McpPanel({ servers }: McpPanelProps) {
  // TODO(T21): add toggle/reconnect actions and live status updates.
  return (
    <section className="rounded border border-stone-800 p-3">
      <h2 className="font-medium">MCP</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {servers.map((server) => (
          <li key={server.id}>
            {server.name} · {server.status}
          </li>
        ))}
      </ul>
    </section>
  );
}

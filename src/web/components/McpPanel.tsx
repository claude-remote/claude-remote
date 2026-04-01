import { useCallback, useState } from 'react';

import type { McpServerInfo } from '@/shared/types';
import type { ClientCommand } from '@/shared/protocol';

interface McpPanelProps {
  servers: McpServerInfo[];
  sendCommand: (command: ClientCommand) => void;
}

const STATUS_COLORS: Record<McpServerInfo['status'], string> = {
  connected: 'bg-green-500',
  disconnected: 'bg-gray-500',
  error: 'bg-red-500',
};

const STATUS_LABELS: Record<McpServerInfo['status'], string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
};

export function McpPanel({ servers, sendCommand }: McpPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [reconnectingIds, setReconnectingIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback(
    (serverId: string, enabled: boolean) => {
      sendCommand({
        cmdId: `mcp-toggle-${Date.now()}`,
        cmd: 'mcp:toggle',
        serverId,
        enabled,
      });
    },
    [sendCommand],
  );

  const handleReconnect = useCallback(
    (serverId: string) => {
      setReconnectingIds((prev) => new Set(prev).add(serverId));
      sendCommand({
        cmdId: `mcp-reconnect-${Date.now()}`,
        cmd: 'mcp:reconnect',
        serverId,
      });
      // Clear reconnecting state after a timeout as a fallback
      setTimeout(() => {
        setReconnectingIds((prev) => {
          const next = new Set(prev);
          next.delete(serverId);
          return next;
        });
      }, 10000);
    },
    [sendCommand],
  );

  const toggleExpanded = useCallback((serverId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  }, []);

  // Clear reconnecting state when server status changes
  const reconnectingServers = new Set(reconnectingIds);
  for (const s of servers) {
    if (s.status === 'connected' || s.status === 'error') {
      reconnectingServers.delete(s.id);
    }
  }

  if (servers.length === 0) {
    return (
      <section className="rounded border border-stone-800 bg-gray-950 p-4">
        <h2 className="text-sm font-medium text-gray-300">MCP Servers</h2>
        <p className="mt-3 text-center text-sm text-stone-500">
          No MCP servers configured
        </p>
      </section>
    );
  }

  return (
    <section className="rounded border border-stone-800 bg-gray-950 p-4">
      <h2 className="text-sm font-medium text-gray-300">MCP Servers</h2>

      {/* Desktop: table layout */}
      <div className="mt-3 hidden md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-800 text-xs text-stone-500">
              <th className="pb-2 font-medium">Server</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Tools</th>
              <th className="pb-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/50">
            {servers.map((server) => (
              <ServerTableRow
                key={server.id}
                server={server}
                expanded={expandedIds.has(server.id)}
                reconnecting={reconnectingServers.has(server.id)}
                onToggle={handleToggle}
                onReconnect={handleReconnect}
                onToggleExpand={toggleExpanded}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: card layout */}
      <div className="mt-3 space-y-2 md:hidden">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            expanded={expandedIds.has(server.id)}
            reconnecting={reconnectingServers.has(server.id)}
            onToggle={handleToggle}
            onReconnect={handleReconnect}
            onToggleExpand={toggleExpanded}
          />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

interface ServerRowProps {
  server: McpServerInfo;
  expanded: boolean;
  reconnecting: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onReconnect: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

function StatusBadge({ status }: { status: McpServerInfo['status'] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-400">
      <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function ToggleSwitch({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        enabled ? 'bg-green-600' : 'bg-stone-700'
      }`}
      onClick={() => onChange(!enabled)}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function ToolList({ server }: { server: McpServerInfo }) {
  if (!server.tools || server.tools.length === 0) {
    return (
      <p className="py-2 text-xs text-stone-500">
        {server.toolCount > 0
          ? `${server.toolCount} tool(s) available`
          : 'No tools registered'}
      </p>
    );
  }

  return (
    <ul className="space-y-1 py-2">
      {server.tools.map((tool) => (
        <li key={tool.name} className="flex items-start gap-2 text-xs">
          <span className="font-mono text-stone-300">{tool.name}</span>
          {tool.description && (
            <span className="text-stone-500">{tool.description}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop: table row                                                 */
/* ------------------------------------------------------------------ */

function ServerTableRow({
  server,
  expanded,
  reconnecting,
  onToggle,
  onReconnect,
  onToggleExpand,
}: ServerRowProps) {
  return (
    <>
      <tr className="group">
        <td className="py-2 pr-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-stone-200 hover:text-white"
            onClick={() => onToggleExpand(server.id)}
          >
            <span
              className={`text-xs text-stone-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              &#9654;
            </span>
            <span className="font-medium">{server.name}</span>
            <span className="text-xs text-stone-600">({server.type})</span>
          </button>
          {server.error && (
            <p className="mt-0.5 text-xs text-red-400">{server.error}</p>
          )}
        </td>
        <td className="py-2 pr-3">
          <StatusBadge status={server.status} />
        </td>
        <td className="py-2 pr-3 text-xs text-stone-400">
          {server.toolCount}
        </td>
        <td className="py-2 text-right">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={reconnecting}
              className="text-xs text-stone-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => onReconnect(server.id)}
            >
              {reconnecting ? 'Reconnecting...' : 'Reconnect'}
            </button>
            <ToggleSwitch
              enabled={server.enabled}
              onChange={(enabled) => onToggle(server.id, enabled)}
            />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="border-b border-stone-800/50 pb-2 pl-6">
            <ToolList server={server} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile: card                                                       */
/* ------------------------------------------------------------------ */

function ServerCard({
  server,
  expanded,
  reconnecting,
  onToggle,
  onReconnect,
  onToggleExpand,
}: ServerRowProps) {
  return (
    <div className="rounded border border-stone-800 bg-gray-900 p-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <button
          type="button"
          className="flex items-center gap-1.5 text-left text-stone-200 hover:text-white"
          onClick={() => onToggleExpand(server.id)}
        >
          <span
            className={`text-xs text-stone-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            &#9654;
          </span>
          <div>
            <span className="font-medium">{server.name}</span>
            <span className="ml-1.5 text-xs text-stone-600">({server.type})</span>
          </div>
        </button>
        <ToggleSwitch
          enabled={server.enabled}
          onChange={(enabled) => onToggle(server.id, enabled)}
        />
      </div>

      {/* Status row */}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={server.status} />
          <span className="text-xs text-stone-500">
            {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          type="button"
          disabled={reconnecting}
          className="text-xs text-stone-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => onReconnect(server.id)}
        >
          {reconnecting ? 'Reconnecting...' : 'Reconnect'}
        </button>
      </div>

      {/* Error */}
      {server.error && (
        <p className="mt-1.5 text-xs text-red-400">{server.error}</p>
      )}

      {/* Expanded tool list */}
      {expanded && (
        <div className="mt-2 border-t border-stone-800 pt-1">
          <ToolList server={server} />
        </div>
      )}
    </div>
  );
}

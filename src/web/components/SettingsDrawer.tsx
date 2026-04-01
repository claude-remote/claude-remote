import type { McpServerInfo, SessionConfig } from '@/shared/types';

interface SettingsDrawerProps {
  config: SessionConfig;
  servers: McpServerInfo[];
}

export function SettingsDrawer({ config, servers }: SettingsDrawerProps) {
  // TODO(T19,T21,T22): organize settings tabs for config, MCP, export, and clear/compact flows.
  return (
    <aside className="rounded border border-stone-800 p-3">
      <p className="text-sm text-stone-400">设置</p>
      <p className="mt-2 text-sm">{config.permissionMode}</p>
      <p className="text-sm text-stone-500">MCP 服务数: {servers.length}</p>
    </aside>
  );
}

import { useCallback, useEffect, useState } from 'react';

import type {
  ConfigOptions,
  McpServerInfo,
  SessionConfig,
  SessionPermissionMode,
} from '@/shared/types';

import { ModelSelector } from './ModelSelector';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  config: SessionConfig;
  options: ConfigOptions;
  servers: McpServerInfo[];
  onConfigChange: (patch: Partial<SessionConfig>) => void;
}

type TabId = 'model' | 'permissions';

export function SettingsDrawer({
  open,
  onClose,
  config,
  options,
  servers,
  onConfigChange,
}: SettingsDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabId>('model');
  const [systemPrompt, setSystemPrompt] = useState('');

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handlePermissionChange = useCallback(
    (mode: SessionPermissionMode) => {
      onConfigChange({ permissionMode: mode });
    },
    [onConfigChange],
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: 'model', label: 'Model' },
    { id: 'permissions', label: 'Permissions' },
  ];

  return (
    <>
      {/* Backdrop overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-80 flex-col bg-gray-900 shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-100">Settings</h2>
          <button
            type="button"
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
            onClick={onClose}
            aria-label="Close settings"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-blue-500 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'model' && (
            <div className="space-y-5">
              {/* Model selector */}
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-400">
                  Model & Effort
                </label>
                <ModelSelector config={config} options={options} onConfigChange={onConfigChange} />
              </div>

              {/* System prompt */}
              <div>
                <label
                  htmlFor="system-prompt"
                  className="mb-2 block text-xs font-medium text-gray-400"
                >
                  System Prompt
                </label>
                <textarea
                  id="system-prompt"
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
                  rows={6}
                  placeholder="Custom system prompt (optional)"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>

              {/* MCP servers summary */}
              <div>
                <p className="text-xs text-gray-500">
                  MCP servers: {servers.filter((s) => s.status === 'connected').length}/
                  {servers.length} connected
                </p>
              </div>
            </div>
          )}

          {activeTab === 'permissions' && (
            <div className="space-y-4">
              <div>
                <label className="mb-3 block text-xs font-medium text-gray-400">
                  Permission Mode
                </label>
                <div className="space-y-2">
                  {(options.permissionModes ?? ['ask', 'approve', 'bypass']).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-xs transition-colors ${
                        config.permissionMode === mode
                          ? 'border-blue-500/50 bg-blue-500/10 text-gray-100'
                          : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                      }`}
                      onClick={() => handlePermissionChange(mode)}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          config.permissionMode === mode
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-gray-600'
                        }`}
                      >
                        {config.permissionMode === mode && (
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        )}
                      </span>
                      <div>
                        <p className="font-medium capitalize">{mode}</p>
                        <p className="mt-0.5 text-[10px] text-gray-500">
                          {mode === 'ask' && 'Ask before running each tool'}
                          {mode === 'approve' && 'Auto-approve safe tools, ask for risky ones'}
                          {mode === 'bypass' && 'Run all tools without asking'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 px-4 py-3">
          <p className="text-center text-[10px] text-gray-600">Changes are applied immediately</p>
        </div>
      </aside>
    </>
  );
}

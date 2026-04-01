import { useCallback, useRef, useState } from 'react';

import type { ConfigOptions, EffortLevel, SessionConfig } from '@/shared/types';

interface ModelSelectorProps {
  config: SessionConfig;
  options: ConfigOptions;
  onConfigChange: (patch: Partial<SessionConfig>) => void;
}

export function ModelSelector({ config, options, onConfigChange }: ModelSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      onConfigChange({ model: modelId });
      setDropdownOpen(false);
    },
    [onConfigChange],
  );

  const handleEffortChange = useCallback(
    (level: EffortLevel) => {
      onConfigChange({ effortLevel: level });
    },
    [onConfigChange],
  );

  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Close dropdown when focus leaves the container
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setDropdownOpen(false);
    }
  }, []);

  const currentModel = options.availableModels.find((m) => m.id === config.model);
  const displayName = currentModel?.name ?? config.model;

  return (
    <div className="relative" ref={containerRef} onBlur={handleBlur}>
      {/* Compact model display + effort segmented control */}
      <div className="flex items-center gap-2">
        {/* Model dropdown trigger */}
        <button
          type="button"
          className="flex items-center gap-1.5 rounded bg-gray-900 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800 hover:text-gray-100 transition-colors"
          onClick={() => setDropdownOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={dropdownOpen}
        >
          <span className="truncate max-w-[120px]">{displayName}</span>
          <svg
            className={`h-3 w-3 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Effort level segmented control */}
        <div className="flex rounded bg-gray-900 p-0.5">
          {(['low', 'medium', 'high'] as EffortLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                config.effortLevel === level
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => handleEffortChange(level)}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Model dropdown list */}
      {dropdownOpen && options.availableModels.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-gray-700 bg-gray-900 py-1 shadow-lg"
        >
          {options.availableModels.map((model) => (
            <li key={model.id} role="option" aria-selected={model.id === config.model}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  model.id === config.model
                    ? 'bg-gray-800 text-gray-100'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
                onClick={() => handleModelSelect(model.id)}
              >
                <span className="flex-1 truncate">{model.name}</span>
                {model.supportsImages && (
                  <span className="shrink-0 text-[9px] text-gray-600" title="Supports images">
                    IMG
                  </span>
                )}
                {model.id === config.model && (
                  <svg className="h-3 w-3 shrink-0 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

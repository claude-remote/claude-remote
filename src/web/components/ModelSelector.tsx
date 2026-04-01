import type { ConfigOptions, SessionConfig } from '@/shared/types';

interface ModelSelectorProps {
  config: SessionConfig;
  options: ConfigOptions;
}

export function ModelSelector({ config, options }: ModelSelectorProps) {
  // TODO(T19): wire config:set for model, effort level, and permission mode changes.
  return (
    <div className="rounded bg-stone-900 px-3 py-2 text-sm">
      {config.model} · {config.effortLevel} · {options.availableModels.length} models
    </div>
  );
}

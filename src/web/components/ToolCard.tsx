import { useCallback, useMemo, useState } from 'react';

import type { ToolResultContentBlock, ToolUseBlock } from '@/shared/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ToolStatus = 'running' | 'completed' | 'failed' | 'crashed';

interface ToolCardProps {
  /** The tool_use block that initiated this call */
  toolUse: ToolUseBlock;
  /** The matching tool_result block, if available yet */
  toolResult?: ToolResultContentBlock;
  /** Overall status */
  status: ToolStatus;
  /** Epoch ms when the tool call started */
  startedAt?: number;
  /** Epoch ms when it finished (if done) */
  finishedAt?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TOOL_ICONS: Record<string, string> = {
  Bash: '\u25b6', // play triangle
  Read: '\u2750', // page
  Edit: '\u270e', // pencil
  Write: '\u2710', // pen
  Grep: '\u2315', // search
  Glob: '\u229b', // circle asterisk
};

function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? '\u2699'; // gear fallback
}

function statusIndicator(status: ToolStatus): React.ReactNode {
  switch (status) {
    case 'running':
      return (
        <span className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
      );
    case 'completed':
      return <span className="ml-auto text-xs text-green-400">{'\u2713'}</span>;
    case 'failed':
    case 'crashed':
      return <span className="ml-auto text-xs text-red-400">{'\u2717'}</span>;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ */
/*  Content renderers by tool type                                     */
/* ------------------------------------------------------------------ */

function renderBashContent(
  input: Record<string, unknown>,
  result?: ToolResultContentBlock,
): React.ReactNode {
  const command = typeof input.command === 'string' ? input.command : '';
  const output = result && typeof result.content === 'string' ? result.content : undefined;

  return (
    <div className="space-y-2">
      {/* Command */}
      <div className="rounded bg-gray-950 p-2 font-mono text-xs">
        <span className="select-none text-green-500">$ </span>
        <span className="text-green-300 whitespace-pre-wrap break-all">{command}</span>
      </div>
      {/* Output */}
      {output !== undefined && (
        <pre className="max-h-64 overflow-auto rounded bg-gray-950 p-2 font-mono text-xs leading-snug text-green-200 whitespace-pre-wrap break-words">
          {output || '(no output)'}
        </pre>
      )}
    </div>
  );
}

function renderFileContent(
  toolName: string,
  input: Record<string, unknown>,
  result?: ToolResultContentBlock,
): React.ReactNode {
  const filePath = typeof input.file_path === 'string' ? input.file_path : '';

  return (
    <div className="space-y-2">
      {/* File path header */}
      <div className="flex items-center gap-1 rounded bg-gray-950 px-2 py-1 font-mono text-xs text-gray-400">
        <span className="text-indigo-400">
          {toolName === 'Read' ? 'READ' : toolName === 'Write' ? 'WRITE' : 'FILE'}
        </span>
        <span className="truncate">{filePath}</span>
      </div>
      {/* Content */}
      {result && typeof result.content === 'string' && result.content.length > 0 && (
        <pre className="max-h-64 overflow-auto rounded bg-gray-950 p-2 font-mono text-xs leading-snug text-gray-300 whitespace-pre-wrap break-words">
          {result.content.length > 4000
            ? `${result.content.slice(0, 4000)}\n... (truncated)`
            : result.content}
        </pre>
      )}
    </div>
  );
}

function renderDiffContent(
  input: Record<string, unknown>,
  _result?: ToolResultContentBlock,
): React.ReactNode {
  const filePath = typeof input.file_path === 'string' ? input.file_path : '';
  const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
  const newStr = typeof input.new_string === 'string' ? input.new_string : '';

  return (
    <div className="space-y-2">
      {/* File path header */}
      <div className="flex items-center gap-1 rounded bg-gray-950 px-2 py-1 font-mono text-xs text-gray-400">
        <span className="text-yellow-400">EDIT</span>
        <span className="truncate">{filePath}</span>
      </div>
      {/* Diff view */}
      <div className="overflow-auto rounded bg-gray-950 font-mono text-xs leading-snug">
        {oldStr && (
          <div className="border-l-2 border-red-500/60 bg-red-950/30 px-2 py-1 whitespace-pre-wrap break-words">
            {oldStr.split('\n').map((line, i) => (
              <div key={`old-${i}`} className="text-red-300">
                <span className="mr-2 select-none text-red-500">-</span>
                {escapeHtml(line) || ' '}
              </div>
            ))}
          </div>
        )}
        {newStr && (
          <div className="border-l-2 border-green-500/60 bg-green-950/30 px-2 py-1 whitespace-pre-wrap break-words">
            {newStr.split('\n').map((line, i) => (
              <div key={`new-${i}`} className="text-green-300">
                <span className="mr-2 select-none text-green-500">+</span>
                {escapeHtml(line) || ' '}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function renderGenericContent(
  input: Record<string, unknown>,
  result?: ToolResultContentBlock,
): React.ReactNode {
  return (
    <div className="space-y-2">
      {Object.keys(input).length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Parameters
          </div>
          <pre className="max-h-48 overflow-auto rounded bg-gray-950 p-2 font-mono text-xs text-gray-300 whitespace-pre-wrap break-words">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
      {result && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Result
          </div>
          <pre className="max-h-48 overflow-auto rounded bg-gray-950 p-2 font-mono text-xs text-gray-300 whitespace-pre-wrap break-words">
            {typeof result.content === 'string'
              ? result.content
              : JSON.stringify(result.content, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton loader                                                    */
/* ------------------------------------------------------------------ */

function ToolSkeleton() {
  return (
    <div className="animate-pulse space-y-2 p-2">
      <div className="h-3 w-3/4 rounded bg-gray-700" />
      <div className="h-3 w-1/2 rounded bg-gray-700" />
      <div className="h-3 w-2/3 rounded bg-gray-700" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function ToolCard({ toolUse, toolResult, status, startedAt, finishedAt }: ToolCardProps) {
  const defaultExpanded = status === 'running' || status === 'failed' || status === 'crashed';
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggle = useCallback(() => setExpanded((prev: boolean) => !prev), []);

  const isError = status === 'failed' || status === 'crashed' || toolResult?.isError;
  const toolName = toolUse.name;
  const input = toolUse.input;

  const duration = useMemo(() => {
    if (startedAt && finishedAt) return formatDuration(finishedAt - startedAt);
    return null;
  }, [startedAt, finishedAt]);

  const content = useMemo(() => {
    if (status === 'running' && !toolResult) return <ToolSkeleton />;

    switch (toolName) {
      case 'Bash':
        return renderBashContent(input, toolResult);
      case 'Read':
      case 'Write':
        return renderFileContent(toolName, input, toolResult);
      case 'Edit':
        return renderDiffContent(input, toolResult);
      default:
        return renderGenericContent(input, toolResult);
    }
  }, [toolName, input, toolResult, status]);

  const borderColor = isError
    ? 'border-red-700/60'
    : status === 'running'
      ? 'border-indigo-700/40'
      : 'border-stone-700/50';

  return (
    <div className={`overflow-hidden rounded-lg border ${borderColor} bg-stone-900`}>
      {/* Header */}
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-stone-800/60"
      >
        {/* Tool icon */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-stone-800 text-[10px] text-gray-400">
          {toolIcon(toolName)}
        </span>

        {/* Tool name */}
        <span className="font-medium text-gray-200">{toolName}</span>

        {/* Compact info: file path or command preview */}
        <span className="min-w-0 truncate text-xs text-gray-500">
          {toolName === 'Bash' && typeof input.command === 'string'
            ? input.command.slice(0, 60)
            : typeof input.file_path === 'string'
              ? (input.file_path as string)
              : ''}
        </span>

        {/* Timing */}
        {startedAt && (
          <span className="shrink-0 text-[10px] text-gray-600">
            {formatTimestamp(startedAt)}
            {duration && <span className="ml-1 text-gray-500">({duration})</span>}
          </span>
        )}

        {/* Status indicator */}
        {statusIndicator(status)}

        {/* Expand/collapse chevron */}
        <span
          className={`shrink-0 text-xs text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          {'\u25bc'}
        </span>
      </button>

      {/* Error banner */}
      {isError && toolResult?.isError && (
        <div className="border-t border-red-800/40 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">
          {typeof toolResult.content === 'string'
            ? toolResult.content.slice(0, 200)
            : 'Tool execution failed'}
        </div>
      )}

      {/* Collapsible body */}
      {expanded && <div className="border-t border-stone-800/60 p-3">{content}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Convenience wrapper for backward compat / simple usage             */
/* ------------------------------------------------------------------ */

interface SimpleToolCardProps {
  title: string;
  body: string;
}

/**
 * Simplified ToolCard for cases where we only have title + body strings.
 * Used as a fallback when full tool_use/tool_result blocks are unavailable.
 */
export function SimpleToolCard({ title, body }: SimpleToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-stone-700/50 bg-stone-900">
      <button
        type="button"
        onClick={() => setExpanded((prev: boolean) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-stone-800/60"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-stone-800 text-[10px] text-gray-400">
          {'\u2699'}
        </span>
        <span className="font-medium text-gray-200">{title}</span>
        <span className="ml-auto text-xs text-green-400">{'\u2713'}</span>
        <span
          className={`shrink-0 text-xs text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          {'\u25bc'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-stone-800/60 p-3">
          <pre className="max-h-48 overflow-auto rounded bg-gray-950 p-2 font-mono text-xs text-gray-300 whitespace-pre-wrap break-words">
            {body}
          </pre>
        </div>
      )}
    </div>
  );
}

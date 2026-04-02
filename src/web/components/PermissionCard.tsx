import { useCallback, useEffect, useState } from 'react';

import type { PermissionRequest } from '@/shared/types';

/** Map tool names to icons (emoji-based for simplicity). */
function toolIcon(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower === 'bash' || lower.includes('terminal') || lower.includes('shell'))
    return '\u2328\uFE0F';
  if (lower === 'read' || lower === 'write' || lower === 'edit' || lower.includes('file'))
    return '\uD83D\uDCC4';
  if (lower.includes('glob') || lower.includes('search') || lower.includes('grep'))
    return '\uD83D\uDD0D';
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('http'))
    return '\uD83C\uDF10';
  if (lower.includes('notebook')) return '\uD83D\uDCD3';
  return '\uD83D\uDD27';
}

/** Truncate a string with an ellipsis. */
function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}\u2026`;
}

/** Format tool input params as a single-line summary. */
function summarizeParams(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(input)) {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    parts.push(`${key}: ${truncate(str, 60)}`);
  }
  return parts.join(', ');
}

interface PermissionCardProps {
  request: PermissionRequest;
  isWriter: boolean;
  onRespond: (requestId: string, approved: boolean) => void;
}

export function PermissionCard({ request, isWriter, onRespond }: PermissionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Live counter: update every second
  useEffect(() => {
    const update = () => setElapsed(Math.floor((Date.now() - request.createdAt) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [request.createdAt]);

  const handleAllow = useCallback(() => {
    onRespond(request.id, true);
  }, [request.id, onRespond]);

  const handleDeny = useCallback(() => {
    onRespond(request.id, false);
  }, [request.id, onRespond]);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const icon = toolIcon(request.toolName);
  const summary = summarizeParams(request.toolInput);
  const fullParams = JSON.stringify(request.toolInput, null, 2);

  const elapsedLabel =
    elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-gray-900/90 p-3 shadow-md">
      {/* Header row */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-lg leading-none" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-amber-300">
              {request.toolName}
            </span>
            <span className="text-xs text-gray-500">waiting {elapsedLabel}</span>
          </div>
          {/* Collapsed param summary */}
          {!expanded && summary && (
            <button
              type="button"
              className="mt-1 block w-full cursor-pointer truncate text-left font-mono text-xs text-gray-400 hover:text-gray-300"
              onClick={toggleExpanded}
              title="Click to expand parameters"
            >
              {truncate(summary, 120)}
            </button>
          )}
          {/* Expanded params */}
          {expanded && (
            <button
              type="button"
              className="mt-1 block w-full cursor-pointer text-left"
              onClick={toggleExpanded}
            >
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-950 p-2 font-mono text-xs text-gray-300">
                {fullParams}
              </pre>
            </button>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-2 flex items-center gap-2">
        {isWriter ? (
          <>
            <button
              type="button"
              className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500 active:bg-green-700 sm:px-3 sm:py-1"
              onClick={handleAllow}
            >
              Allow
            </button>
            <button
              type="button"
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 active:bg-red-700 sm:px-3 sm:py-1"
              onClick={handleDeny}
            >
              Deny
            </button>
          </>
        ) : (
          <span className="text-xs italic text-gray-500" title="Only the active writer can approve">
            Only the active writer can approve
          </span>
        )}
      </div>
    </div>
  );
}

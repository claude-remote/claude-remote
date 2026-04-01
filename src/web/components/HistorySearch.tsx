import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HistorySearchResult } from '@/shared/types';

type SearchScope = 'session' | 'all';

interface HistorySearchProps {
  /** Current session ID for scoped searches */
  sessionId?: string;
  /** Send a WebSocket command and return matching results */
  onSearch: (query: string, scope: SearchScope) => void;
  /** Results from the latest search */
  results: HistorySearchResult[];
  /** Whether a search is in-flight */
  loading?: boolean;
  /** Navigate to a specific message in a session */
  onNavigate: (sessionId: string, messageId: string) => void;
  /** Close the search overlay */
  onClose: () => void;
  /** Whether the overlay is visible */
  visible: boolean;
}

/** Format a timestamp into a relative human-readable string. */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Highlight all occurrences of `query` within `text`. */
function highlightSnippet(text: string, query: string): React.ReactNode[] {
  if (!query.trim()) return [text];
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let cursor = 0;
  let idx = lower.indexOf(q, cursor);
  let key = 0;

  while (idx !== -1) {
    if (idx > cursor) {
      parts.push(<span key={key++}>{text.slice(cursor, idx)}</span>);
    }
    parts.push(
      <mark key={key++} className="rounded-sm bg-amber-500/30 text-amber-200">
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    cursor = idx + query.length;
    idx = lower.indexOf(q, cursor);
  }

  if (cursor < text.length) {
    parts.push(<span key={key++}>{text.slice(cursor)}</span>);
  }

  return parts;
}

export function HistorySearch({
  sessionId,
  onSearch,
  results,
  loading = false,
  onNavigate,
  onClose,
  visible,
}: HistorySearchProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>(sessionId ? 'session' : 'all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when overlay becomes visible
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIndex(0);
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  // Debounced search
  useEffect(() => {
    if (!visible) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) return;

    debounceRef.current = setTimeout(() => {
      onSearch(query.trim(), scope);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, scope, visible, onSearch]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (result: HistorySearchResult) => {
      onNavigate(result.sessionId, result.messageId);
      onClose();
    },
    [onNavigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev <= 0 ? Math.max(results.length - 1, 0) : prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev >= results.length - 1 ? 0 : prev + 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, handleSelect, onClose],
  );

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (visible) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, onClose]);

  const hasQuery = query.trim().length > 0;

  const emptyState = useMemo(() => {
    if (loading) return null;
    if (!hasQuery) return 'Start typing to search history...';
    if (results.length === 0) return 'No results found';
    return null;
  }, [loading, hasQuery, results.length]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={() => {}}
      role="presentation"
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-stone-700 bg-stone-900 shadow-2xl"
        role="dialog"
        aria-label="History search"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-stone-700 px-4 py-3">
          <svg
            className="h-4 w-4 shrink-0 text-stone-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations..."
            className="min-w-0 flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-500 outline-none"
            spellCheck={false}
          />
          {loading && (
            <svg
              className="h-4 w-4 shrink-0 animate-spin text-stone-500"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          <kbd className="hidden shrink-0 rounded border border-stone-700 bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-500 sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Scope toggle */}
        <div className="flex items-center gap-1 border-b border-stone-800 px-4 py-2">
          <span className="mr-2 text-xs text-stone-500">Scope:</span>
          <button
            type="button"
            onClick={() => setScope('session')}
            disabled={!sessionId}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              scope === 'session'
                ? 'bg-indigo-600/30 text-indigo-300'
                : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            This session
          </button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              scope === 'all'
                ? 'bg-indigo-600/30 text-indigo-300'
                : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            All sessions
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto" role="listbox">
          {emptyState && (
            <p className="px-4 py-8 text-center text-sm text-stone-500">{emptyState}</p>
          )}

          {results.map((result, i) => (
            <button
              key={`${result.sessionId}-${result.messageId}`}
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors ${
                i === selectedIndex
                  ? 'bg-stone-800/80 text-stone-100'
                  : 'text-stone-300 hover:bg-stone-800/40'
              }`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => handleSelect(result)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-stone-400">
                  {result.sessionName}
                </span>
                <span className="shrink-0 text-[10px] text-stone-600">
                  {relativeTime(result.timestamp)}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase ${
                    result.role === 'user'
                      ? 'bg-indigo-900/40 text-indigo-400'
                      : 'bg-emerald-900/40 text-emerald-400'
                  }`}
                >
                  {result.role}
                </span>
                <p className="min-w-0 flex-1 text-sm leading-relaxed">
                  {highlightSnippet(result.snippet, query)}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="flex items-center gap-3 border-t border-stone-800 px-4 py-2">
            <span className="text-[10px] text-stone-600">
              <kbd className="rounded border border-stone-700 px-1">&#8593;&#8595;</kbd> navigate
            </span>
            <span className="text-[10px] text-stone-600">
              <kbd className="rounded border border-stone-700 px-1">Enter</kbd> open
            </span>
            <span className="text-[10px] text-stone-600">
              <kbd className="rounded border border-stone-700 px-1">Esc</kbd> close
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

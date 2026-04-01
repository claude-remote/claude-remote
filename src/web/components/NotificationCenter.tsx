import { useCallback, useEffect, useRef, useState } from 'react';

import type { HubEvent } from '@/shared/protocol';

// ── Types ──────────────────────────────────────────────────────────────

type NotificationType = 'permission' | 'context' | 'mcp' | 'writer' | 'shutdown';

interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  read: boolean;
  /** Non-critical notifications auto-dismiss after 30 s */
  critical: boolean;
}

export interface NotificationCenterProps {
  /** Register a HubEvent listener; returns an unsubscribe function. */
  onEvent?: (handler: (event: HubEvent) => void) => () => void;
}

const MAX_NOTIFICATIONS = 50;
const AUTO_DISMISS_MS = 30_000;

// ── Helpers ────────────────────────────────────────────────────────────

let _nextId = 0;
function nextId(): string {
  return `notif-${Date.now()}-${++_nextId}`;
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const ICON_BY_TYPE: Record<NotificationType, string> = {
  permission: '⚠',
  context: '◐',
  mcp: '✖',
  writer: 'ℹ',
  shutdown: '⏻',
};

const COLOR_BY_TYPE: Record<NotificationType, string> = {
  permission: 'text-amber-400',
  context: 'text-yellow-400',
  mcp: 'text-red-400',
  writer: 'text-blue-400',
  shutdown: 'text-red-400',
};

// ── Component ──────────────────────────────────────────────────────────

export function NotificationCenter({ onEvent }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerMapRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Push helper ──────────────────────────────────────────────────────

  const push = useCallback((type: NotificationType, message: string, critical: boolean) => {
    const id = nextId();

    setNotifications((prev) => {
      const next = [{ id, type, message, timestamp: Date.now(), read: false, critical }, ...prev];
      // Enforce cap – drop oldest
      return next.length > MAX_NOTIFICATIONS ? next.slice(0, MAX_NOTIFICATIONS) : next;
    });

    // Auto-dismiss non-critical after 30 s
    if (!critical) {
      const timer = setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        timerMapRef.current.delete(id);
      }, AUTO_DISMISS_MS);
      timerMapRef.current.set(id, timer);
    }
  }, []);

  // ── Subscribe to hub events ──────────────────────────────────────────

  useEffect(() => {
    if (!onEvent) return;

    const unsubscribe = onEvent((event: HubEvent) => {
      switch (event.type) {
        case 'hub:mcp:statusChanged': {
          const s = event.server;
          if (s.status === 'disconnected' || s.status === 'error') {
            push('mcp', `MCP server ${s.name} ${s.status}${s.error ? `: ${s.error}` : ''}`, true);
          }
          break;
        }
        case 'hub:writer:changed': {
          const writerId = event.newWriterId;
          if (writerId) {
            push('writer', `Writer changed to ${writerId}`, false);
          } else {
            push('writer', 'No active writer', false);
          }
          break;
        }
        case 'hub:shutdown': {
          push('shutdown', 'Hub is shutting down', true);
          break;
        }
        case 'hub:context:updated': {
          const pct = event.usage.percentage;
          if (pct >= 85) {
            push('context', `Context is ${Math.round(pct)}% full`, pct >= 95);
          }
          break;
        }
        case 'sdk:control': {
          const payload = event.payload;
          if (payload.type === 'control_request') {
            const req = payload.request as Record<string, unknown>;
            const toolName = (req.toolName as string) || 'unknown tool';
            push('permission', `Tool ${toolName} needs approval`, true);
          }
          break;
        }
        default:
          break;
      }
    });

    return unsubscribe;
  }, [onEvent, push]);

  // ── Cleanup timers on unmount ────────────────────────────────────────

  useEffect(() => {
    return () => {
      for (const t of timerMapRef.current.values()) clearTimeout(t);
    };
  }, []);

  // ── Close dropdown on outside click ──────────────────────────────────

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // ── Mark all as read when opening ────────────────────────────────────

  useEffect(() => {
    if (open) {
      setNotifications((prev) =>
        prev.some((n) => !n.read) ? prev.map((n) => ({ ...n, read: true })) : prev,
      );
    }
  }, [open]);

  // ── Refresh relative timestamps ──────────────────────────────────────

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [open]);

  // ── Derived ──────────────────────────────────────────────────────────

  const unreadCount = notifications.filter((n) => !n.read).length;

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    const timer = timerMapRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timerMapRef.current.delete(id);
    }
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    for (const t of timerMapRef.current.values()) clearTimeout(t);
    timerMapRef.current.clear();
  }, []);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-200 focus:outline-none"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        {/* Bell SVG icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl sm:w-96"
          role="dialog"
          aria-label="Notification center"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
            <span className="text-sm font-medium text-gray-200">Notifications</span>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <ul className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-gray-500">No notifications</li>
            ) : (
              notifications.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start gap-2 border-b border-gray-800/50 px-4 py-2.5 last:border-0"
                >
                  <span className={`mt-0.5 text-sm ${COLOR_BY_TYPE[n.type]}`} aria-hidden>
                    {ICON_BY_TYPE[n.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200">{n.message}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{relativeTime(n.timestamp)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(n.id)}
                    className="shrink-0 p-0.5 text-gray-600 hover:text-gray-300"
                    aria-label="Dismiss notification"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

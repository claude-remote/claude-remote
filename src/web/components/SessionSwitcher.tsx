import { useCallback } from 'react';

import type { SessionMeta, SessionStatus } from '@/shared/types';

const STATUS_DOT_COLORS: Record<SessionStatus, string> = {
  active: 'bg-green-500',
  idle: 'bg-yellow-500',
  interrupted: 'bg-red-500',
  archived: 'bg-stone-500',
};

interface SessionSwitcherProps {
  sessions: SessionMeta[];
  activeSessionId?: string | null;
  onCreateSession?: () => void;
}

export function SessionSwitcher({
  sessions,
  activeSessionId,
  onCreateSession,
}: SessionSwitcherProps) {
  const handleNavigate = useCallback((id: string) => {
    globalThis.location.assign(`/chat/${id}`);
  }, []);

  const handleCreate = useCallback(() => {
    if (onCreateSession) {
      onCreateSession();
    } else {
      globalThis.location.assign('/sessions');
    }
  }, [onCreateSession]);

  return (
    <nav className="flex h-full flex-col border-r border-stone-800 bg-stone-950">
      <div className="flex items-center justify-between border-b border-stone-800 px-3 py-2">
        <a
          href="/sessions"
          className="text-xs font-semibold uppercase tracking-wider text-stone-400 transition-colors hover:text-stone-200"
        >
          Sessions
        </a>
        <button
          type="button"
          onClick={handleCreate}
          className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
          title="New session"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <p className="px-3 py-4 text-xs text-stone-600">No sessions</p>
        )}

        <ul className="space-y-0.5 p-1.5">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => handleNavigate(session.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-stone-800 text-stone-100'
                      : 'text-stone-400 hover:bg-stone-900 hover:text-stone-200'
                  }`}
                  title={session.name}
                >
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_COLORS[session.status]}`}
                  />
                  <span className="truncate">{session.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

import type { SessionMeta } from '@/shared/types';

interface SessionSwitcherProps {
  sessions: SessionMeta[];
}

export function SessionSwitcher({ sessions }: SessionSwitcherProps) {
  // TODO(T13): render session list, create flow, archive action, and interrupted recovery.
  return (
    <section className="space-y-2">
      {sessions.map((session) => (
        <button
          key={session.id}
          className="flex w-full items-center justify-between rounded border border-stone-800 p-3 text-left"
        >
          <span>{session.name}</span>
          <span className="text-xs text-stone-400">{session.status}</span>
        </button>
      ))}
      {sessions.length === 0 ? <p className="text-sm text-stone-500">暂无 session</p> : null}
    </section>
  );
}

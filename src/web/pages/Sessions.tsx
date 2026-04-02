import { useCallback, useEffect, useState } from 'react';

import type { SessionMeta, SessionStatus } from '@/shared/types';

import { SessionSwitcher } from '@/web/components/SessionSwitcher';
import { useSessionStore } from '@/web/stores/sessionStore';

const STATUS_COLORS: Record<SessionStatus, string> = {
  active: 'bg-green-500',
  idle: 'bg-yellow-500',
  interrupted: 'bg-red-500',
  archived: 'bg-stone-500',
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  active: 'Active',
  idle: 'Idle',
  interrupted: 'Interrupted',
  archived: 'Archived',
};

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncateCwd(cwd: string, maxLen = 32): string {
  if (cwd.length <= maxLen) return cwd;
  return `...${cwd.slice(-(maxLen - 3))}`;
}

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]} bg-opacity-20 text-stone-200`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-stone-800 bg-stone-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="h-5 w-32 rounded bg-stone-700" />
        <div className="h-5 w-16 rounded-full bg-stone-700" />
      </div>
      <div className="mb-2 h-4 w-48 rounded bg-stone-800" />
      <div className="h-3 w-24 rounded bg-stone-800" />
    </div>
  );
}

function EmptyState({ onCreateSession }: { onCreateSession: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 rounded-full border border-stone-700 p-4">
        <svg
          className="h-8 w-8 text-stone-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
          />
        </svg>
      </div>
      <p className="mb-1 text-lg font-medium text-stone-300">No sessions yet</p>
      <p className="mb-6 text-sm text-stone-500">Create your first session to get started.</p>
      <button
        type="button"
        onClick={onCreateSession}
        className="rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-900 transition-colors hover:bg-white"
      >
        Create Session
      </button>
    </div>
  );
}

function ArchiveConfirmDialog({
  sessionName,
  onConfirm,
  onCancel,
}: {
  sessionName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-stone-700 bg-stone-900 p-5">
        <h3 className="mb-2 text-sm font-semibold text-stone-100">Archive session?</h3>
        <p className="mb-4 text-sm text-stone-400">
          &quot;{sessionName}&quot; will be archived. You can still view it later.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-600/20 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-600/30"
          >
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}

interface SessionCardProps {
  session: SessionMeta;
  onNavigate: (id: string) => void;
  onArchive: (id: string) => void;
  onContinue?: (id: string) => void;
}

function SessionCard({ session, onNavigate, onArchive, onContinue }: SessionCardProps) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(session.id)}
      className="group w-full rounded-lg border border-stone-800 bg-stone-900 p-4 text-left transition-colors hover:border-stone-600 hover:bg-stone-800/80"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-stone-200 group-hover:text-white">
          {session.name}
        </h3>
        <StatusBadge status={session.status} />
      </div>

      <p className="mb-1 font-mono text-xs text-stone-500" title={session.cwd}>
        {truncateCwd(session.cwd)}
      </p>

      <div className="mb-3 flex items-center gap-2 text-xs text-stone-500">
        <span>{formatRelativeTime(session.updatedAt)}</span>
        {session.clientCount > 0 && (
          <>
            <span className="text-stone-700">&middot;</span>
            <span>
              {session.clientCount} client{session.clientCount !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {session.tags && session.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {session.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {session.status === 'interrupted' && (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {onContinue && (
            <button
              type="button"
              onClick={() => onContinue(session.id)}
              className="rounded bg-green-600/20 px-3 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-600/30"
            >
              Continue
            </button>
          )}
          <button
            type="button"
            onClick={() => onArchive(session.id)}
            className="rounded bg-stone-700/50 px-3 py-1 text-xs font-medium text-stone-400 transition-colors hover:bg-stone-700"
          >
            Archive
          </button>
        </div>
      )}

      {session.status !== 'interrupted' && session.status !== 'archived' && (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onArchive(session.id)}
            className="rounded bg-stone-700/50 px-3 py-1 text-xs font-medium text-stone-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-stone-700"
          >
            Archive
          </button>
        </div>
      )}
    </button>
  );
}

export function Sessions() {
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const [loading, setLoading] = useState(true);
  const [archiveTarget, setArchiveTarget] = useState<SessionMeta | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' });
      if (res.ok) {
        const data: SessionMeta[] = await res.json();
        setSessions(data);
      }
    } finally {
      setLoading(false);
    }
  }, [setSessions]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleNavigate = useCallback((id: string) => {
    globalThis.location.assign(`/chat/${id}`);
  }, []);

  const handleCreateSession = useCallback(async () => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Session', cwd: '~' }),
      credentials: 'include',
    });
    if (res.ok) {
      const session: SessionMeta = await res.json();
      globalThis.location.assign(`/chat/${session.id}`);
    }
  }, []);

  const handleRequestArchive = useCallback(
    (id: string) => {
      const session = sessions.find((s) => s.id === id);
      if (session) setArchiveTarget(session);
    },
    [sessions],
  );

  const handleConfirmArchive = useCallback(async () => {
    if (!archiveTarget) return;
    await fetch(`/api/sessions/${archiveTarget.id}/archive`, {
      method: 'POST',
      credentials: 'include',
    });
    setArchiveTarget(null);
    await fetchSessions();
  }, [archiveTarget, fetchSessions]);

  const handleContinue = useCallback((id: string) => {
    globalThis.location.assign(`/chat/${id}`);
  }, []);

  return (
    <div className="flex min-h-screen bg-stone-950">
      {/* Sidebar switcher - hidden on mobile */}
      <aside className="hidden w-56 shrink-0 md:block">
        <SessionSwitcher sessions={sessions} onCreateSession={handleCreateSession} />
      </aside>

      <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-stone-100">Sessions</h1>
          <button
            type="button"
            onClick={handleCreateSession}
            className="flex items-center gap-1.5 rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-900 transition-colors hover:bg-white"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Session
          </button>
        </header>

        {loading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {!loading && sessions.length === 0 && <EmptyState onCreateSession={handleCreateSession} />}

        {!loading && sessions.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onNavigate={handleNavigate}
                onArchive={handleRequestArchive}
                onContinue={handleContinue}
              />
            ))}
          </div>
        )}
      </main>

      {archiveTarget && (
        <ArchiveConfirmDialog
          sessionName={archiveTarget.name}
          onConfirm={handleConfirmArchive}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
    </div>
  );
}

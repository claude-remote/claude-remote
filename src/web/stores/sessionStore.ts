import { create } from 'zustand';

import type { SessionMeta, SessionSnapshot } from '@/shared/types';

interface SessionStoreState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  activeSnapshot: SessionSnapshot | null;

  fetchSessions: () => Promise<void>;
  createSession: (name?: string) => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  setSessions: (sessions: SessionMeta[]) => void;
  setSnapshot: (snapshot: SessionSnapshot) => void;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeSnapshot: null,

  async fetchSessions() {
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' });
      if (res.ok) {
        const sessions = (await res.json()) as SessionMeta[];
        set({ sessions });
      }
    } catch {
      // Network error - sessions remain stale
    }
  },

  async createSession(name?: string) {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name ?? 'New Session', cwd: '~' }),
        credentials: 'include',
      });
      if (res.ok) {
        const session = (await res.json()) as SessionMeta;
        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: session.id,
        }));
      }
    } catch {
      // Network error
    }
  },

  async archiveSession(id: string) {
    try {
      const res = await fetch(`/api/sessions/${id}/archive`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
          activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        }));
      }
    } catch {
      // Network error
    }
  },

  setActive(id: string) {
    set({ activeSessionId: id });
  },

  setSessions(sessions: SessionMeta[]) {
    set({ sessions });
  },

  setSnapshot(snapshot: SessionSnapshot) {
    set({ activeSnapshot: snapshot, activeSessionId: snapshot.meta.id });
    // Also update the session in the list
    const { sessions } = get();
    const idx = sessions.findIndex((s) => s.id === snapshot.meta.id);
    if (idx >= 0) {
      const updated = [...sessions];
      updated[idx] = snapshot.meta;
      set({ sessions: updated });
    }
  },
}));

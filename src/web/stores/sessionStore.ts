import { create } from 'zustand';

import type { SessionMeta, SessionSnapshot } from '@/shared/types';

interface SessionStoreState {
  sessions: SessionMeta[];
  activeSnapshot?: SessionSnapshot;
  setSessions(sessions: SessionMeta[]): void;
  setSnapshot(snapshot: SessionSnapshot): void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  sessions: [],
  activeSnapshot: undefined,
  setSessions(sessions) {
    // TODO(T11,T13): normalize session metadata, recency, and status summaries.
    set({ sessions });
  },
  setSnapshot(snapshot) {
    // TODO(T11): merge reconnect snapshots with local UI state.
    set({ activeSnapshot: snapshot });
  },
}));

import type { Session, SessionMeta, SessionSnapshot, SessionStatus } from '@/shared/types';

import { SqliteStore } from '@/hub/store/SqliteStore';
import { EventBus } from '@/hub/EventBus';

export interface CreateSessionInput {
  cwd: string;
  name?: string;
}

export class SessionManager {
  constructor(
    readonly store: SqliteStore,
    readonly eventBus: EventBus,
  ) {}

  createSession(_input: CreateSessionInput): SessionMeta {
    // TODO(T03): enforce resource limits, writer assignment, and idle eviction.
    throw new Error('Not implemented');
  }

  listSessions(): SessionMeta[] {
    // TODO(T03): include active/idle/interrupted ordering and crash recovery metadata.
    return this.store.listSessions();
  }

  getSession(_sessionId: string): Session | null {
    // TODO(T03): hydrate session runtime state from store and in-memory mirrors.
    return null;
  }

  getSnapshot(_sessionId: string, _clientId: string): SessionSnapshot {
    // TODO(T03): build a reconnect-safe snapshot for a specific client connection.
    throw new Error('Not implemented');
  }

  updateStatus(_sessionId: string, _status: SessionStatus): void {
    // TODO(T03): implement the session state machine and idle timeout transitions.
  }

  archiveSession(_sessionId: string): void {
    // TODO(T03): terminate owned child processes and persist archived state.
  }
}

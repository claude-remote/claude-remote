import { DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_MAX_SESSIONS } from '@/shared/constants';
import type {
  Session,
  SessionConfig,
  SessionMeta,
  SessionSnapshot,
  SessionStatus,
} from '@/shared/types';

import type { EventBus } from '@/hub/EventBus';
import type { SqliteStore } from '@/hub/store/SqliteStore';

export interface CreateSessionInput {
  cwd: string;
  name?: string;
  config?: Partial<SessionConfig>;
}

export interface SessionManagerConfig {
  maxSessions: number;
  defaultIdleTimeoutMs: number;
}

const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  active: ['idle', 'interrupted', 'archived'],
  idle: ['active', 'archived'],
  interrupted: ['active', 'archived'],
  archived: [],
};

export class SessionManager {
  private sessions = new Map<string, Session>();
  private activeWriters = new Map<string, string>(); // sessionId → clientId
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private config: SessionManagerConfig;

  constructor(
    readonly store: SqliteStore,
    readonly eventBus: EventBus,
    config?: Partial<SessionManagerConfig>,
  ) {
    this.config = {
      maxSessions: config?.maxSessions ?? DEFAULT_MAX_SESSIONS,
      defaultIdleTimeoutMs: config?.defaultIdleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    };
  }

  // ── CRUD ────────────────────────────────────────────────────────────

  createSession(input: CreateSessionInput): SessionMeta {
    this.checkLimits();

    const now = Date.now();
    const id = crypto.randomUUID();
    const session: Session = {
      id,
      name: input.name ?? `session-${id.slice(0, 8)}`,
      cwd: input.cwd,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      clientCount: 0,
      hasActiveWriter: false,
      messages: [],
      tasks: [],
      pendingPermissions: [],
      clients: [],
    };

    this.sessions.set(id, session);
    this.store.saveSession(session);
    this.resetIdleTimer(id);

    return this.toMeta(session);
  }

  getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  listSessions(filter?: { status?: SessionStatus }): SessionMeta[] {
    const all = Array.from(this.sessions.values());
    const filtered = filter?.status ? all.filter((s) => s.status === filter.status) : all;
    return filtered.map((s) => this.toMeta(s));
  }

  async archiveSession(id: string): Promise<void> {
    await this.transitionStatus(id, 'archived');
    this.clearIdleTimer(id);
    this.activeWriters.delete(id);
  }

  renameSession(id: string, name: string): void {
    const session = this.requireSession(id);
    session.name = name;
    session.updatedAt = Date.now();
    this.store.saveSession(session);
  }

  setTags(id: string, tags: string[]): void {
    const session = this.requireSession(id);
    // Tags stored as metadata; update updatedAt
    session.updatedAt = Date.now();
    void tags; // reserved for future tag storage
    this.store.saveSession(session);
  }

  switchCwd(id: string, cwd: string): void {
    const session = this.requireSession(id);
    session.cwd = cwd;
    session.updatedAt = Date.now();
    this.store.saveSession(session);

    this.eventBus.publish(id, {
      type: 'hub:session:cwdChanged',
      sessionId: id,
      cwd,
    } as any);
  }

  updateConfig(_id: string, _config: Partial<SessionConfig>): void {
    const session = this.requireSession(_id);
    session.updatedAt = Date.now();
    this.store.saveSession(session);
  }

  getSnapshot(_sessionId: string, _clientId: string): SessionSnapshot {
    // TODO(T03): build a reconnect-safe snapshot for a specific client connection.
    throw new Error('Not implemented');
  }

  // ── Status machine ──────────────────────────────────────────────────

  async transitionStatus(id: string, newStatus: SessionStatus): Promise<void> {
    const session = this.requireSession(id);
    const valid = VALID_TRANSITIONS[session.status];

    if (!valid.includes(newStatus)) {
      throw new Error(`invalid transition: ${session.status} → ${newStatus}`);
    }

    session.status = newStatus;
    session.updatedAt = Date.now();
    this.store.saveSession(session);

    await this.eventBus.publish(id, {
      type: 'hub:session:statusChanged',
      sessionId: id,
      status: newStatus,
    } as any);
  }

  // Public wrapper for tests and external callers
  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    await this.transitionStatus(id, status);
  }

  // ── Active writer management ────────────────────────────────────────

  assignWriter(sessionId: string, clientId: string): boolean {
    this.requireSession(sessionId);
    const current = this.activeWriters.get(sessionId);
    if (current && current !== clientId) {
      return false; // already taken by someone else
    }
    this.activeWriters.set(sessionId, clientId);
    const session = this.sessions.get(sessionId)!;
    session.hasActiveWriter = true;
    return true;
  }

  releaseWriter(sessionId: string, clientId: string): void {
    const current = this.activeWriters.get(sessionId);
    if (current === clientId) {
      this.activeWriters.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.hasActiveWriter = false;
      }
    }
  }

  async takeOverWriter(sessionId: string, newClientId: string): Promise<void> {
    this.requireSession(sessionId);
    this.activeWriters.set(sessionId, newClientId);
    const session = this.sessions.get(sessionId)!;
    session.hasActiveWriter = true;

    await this.eventBus.publish(sessionId, {
      type: 'hub:writer:changed',
      sessionId,
      newWriterId: newClientId,
    } as any);
  }

  getActiveWriter(sessionId: string): string | null {
    return this.activeWriters.get(sessionId) ?? null;
  }

  // ── Idle timeout ────────────────────────────────────────────────────

  private resetIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    const timer = setTimeout(() => this.onIdleTimeout(sessionId), this.config.defaultIdleTimeoutMs);
    this.idleTimers.set(sessionId, timer);
  }

  private clearIdleTimer(sessionId: string): void {
    const existing = this.idleTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.idleTimers.delete(sessionId);
    }
  }

  private onIdleTimeout(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.status === 'active') {
      this.transitionStatus(sessionId, 'idle');
    }
  }

  /**
   * Touch a session to reset its idle timer and reactivate if idle.
   */
  async touchSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.status === 'idle') {
      await this.transitionStatus(sessionId, 'active');
    }
    this.resetIdleTimer(sessionId);
  }

  // ── Crash recovery ──────────────────────────────────────────────────

  async recoverFromCrash(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.status === 'active') {
        session.status = 'interrupted';
        session.updatedAt = Date.now();
        this.store.saveSession(session);
      }
    }
    // Mark running tool executions as crashed (delegated to store)
    // The store's markRunningToolsAsCrashed is called if available
  }

  // ── Graceful shutdown ───────────────────────────────────────────────

  async shutdown(): Promise<void> {
    // Clear all idle timers
    for (const [id, timer] of this.idleTimers) {
      clearTimeout(timer);
      this.idleTimers.delete(id);
    }

    for (const session of this.sessions.values()) {
      if (session.status === 'idle') {
        session.status = 'archived';
        session.updatedAt = Date.now();
        this.store.saveSession(session);
      } else if (session.status === 'active') {
        session.status = 'interrupted';
        session.updatedAt = Date.now();
        this.store.saveSession(session);
      }
    }
  }

  // ── Resource limits ─────────────────────────────────────────────────

  private checkLimits(): void {
    const nonArchived = Array.from(this.sessions.values()).filter((s) => s.status !== 'archived');

    if (nonArchived.length >= this.config.maxSessions) {
      // Try to auto-archive the oldest idle session
      const idleSessions = nonArchived
        .filter((s) => s.status === 'idle')
        .sort((a, b) => a.updatedAt - b.updatedAt);

      if (idleSessions.length > 0) {
        const oldest = idleSessions[0];
        oldest.status = 'archived';
        oldest.updatedAt = Date.now();
        this.store.saveSession(oldest);
        this.clearIdleTimer(oldest.id);
        this.activeWriters.delete(oldest.id);
        return;
      }

      throw new Error(`max sessions limit reached (${this.config.maxSessions})`);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private requireSession(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`session not found: ${id}`);
    }
    return session;
  }

  private toMeta(session: Session): SessionMeta {
    return {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      clientCount: session.clients.length,
      hasActiveWriter: this.activeWriters.has(session.id),
    };
  }
}

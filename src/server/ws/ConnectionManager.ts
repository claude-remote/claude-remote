import type { ClientType, WriterStatus } from '@/shared/types';

/**
 * Represents a single WebSocket connection to the Hub.
 */
export interface Connection {
  ws: WebSocketLike;
  clientId: string;
  sessionId: string;
  role: WriterStatus;
  clientType: ClientType;
  connectedAt: number;
  userAgent?: string;
  /** Monotonically increasing heartbeat tracker. Set to Date.now() on each pong. */
  lastPong: number;
}

/**
 * Minimal WebSocket interface — decoupled from runtime-specific implementations.
 */
export interface WebSocketLike {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

/** WebSocket readyState constants */
const WS_OPEN = 1;

/**
 * Tracks all active WebSocket connections across sessions.
 *
 * Provides efficient lookup by session, by client ID, and broadcast helpers.
 * Thread-safe within a single Bun/Node event loop (no concurrent mutations).
 */
export class ConnectionManager {
  /** sessionId → Set<Connection> */
  private bySession = new Map<string, Set<Connection>>();
  /** clientId → Connection (globally unique) */
  private byClientId = new Map<string, Connection>();

  // ── Add / Remove ──────────────────────────────────────────────────

  /**
   * Register a new connection. The caller must ensure clientId is unique.
   */
  add(conn: Connection): void {
    this.byClientId.set(conn.clientId, conn);

    let set = this.bySession.get(conn.sessionId);
    if (!set) {
      set = new Set();
      this.bySession.set(conn.sessionId, set);
    }
    set.add(conn);
  }

  /**
   * Remove a connection by client ID. Returns the removed Connection or null.
   */
  remove(clientId: string): Connection | null {
    const conn = this.byClientId.get(clientId);
    if (!conn) return null;

    this.byClientId.delete(clientId);

    const set = this.bySession.get(conn.sessionId);
    if (set) {
      set.delete(conn);
      if (set.size === 0) {
        this.bySession.delete(conn.sessionId);
      }
    }

    return conn;
  }

  // ── Lookup ────────────────────────────────────────────────────────

  /**
   * Get all connections for a session.
   */
  getBySession(sessionId: string): Connection[] {
    const set = this.bySession.get(sessionId);
    return set ? [...set] : [];
  }

  /**
   * Get the active writer connection for a session, or null.
   */
  getWriter(sessionId: string): Connection | null {
    const set = this.bySession.get(sessionId);
    if (!set) return null;
    for (const conn of set) {
      if (conn.role === 'active') return conn;
    }
    return null;
  }

  /**
   * Get a connection by client ID.
   */
  getByClientId(clientId: string): Connection | null {
    return this.byClientId.get(clientId) ?? null;
  }

  /**
   * Count connections for a session.
   */
  countBySession(sessionId: string): number {
    return this.bySession.get(sessionId)?.size ?? 0;
  }

  /**
   * Total number of tracked connections.
   */
  get size(): number {
    return this.byClientId.size;
  }

  // ── Broadcast ─────────────────────────────────────────────────────

  /**
   * Send a text message to all open connections in a session.
   */
  broadcast(sessionId: string, message: string): void {
    const set = this.bySession.get(sessionId);
    if (!set) return;

    for (const conn of set) {
      if (conn.ws.readyState === WS_OPEN) {
        conn.ws.send(message);
      }
    }
  }

  /**
   * Send a text message to all open connections across all sessions.
   */
  broadcastAll(message: string): void {
    for (const conn of this.byClientId.values()) {
      if (conn.ws.readyState === WS_OPEN) {
        conn.ws.send(message);
      }
    }
  }

  /**
   * Send a text message to a specific client.
   */
  sendTo(clientId: string, message: string): boolean {
    const conn = this.byClientId.get(clientId);
    if (!conn || conn.ws.readyState !== WS_OPEN) return false;
    conn.ws.send(message);
    return true;
  }

  // ── Writer management ─────────────────────────────────────────────

  /**
   * Promote a standby connection to active writer.
   * If there is already an active writer for that session, it is demoted to standby.
   * Returns true if the promotion succeeded.
   */
  promoteToWriter(clientId: string): boolean {
    const conn = this.byClientId.get(clientId);
    if (!conn) return false;

    // Demote existing writer
    const currentWriter = this.getWriter(conn.sessionId);
    if (currentWriter && currentWriter.clientId !== clientId) {
      currentWriter.role = 'standby';
    }

    conn.role = 'active';
    return true;
  }

  /**
   * Demote the active writer for a session to standby.
   * Returns the demoted client ID or null.
   */
  demoteWriter(sessionId: string): string | null {
    const writer = this.getWriter(sessionId);
    if (!writer) return null;
    writer.role = 'standby';
    return writer.clientId;
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  /**
   * Remove all connections for a session. Returns removed connections.
   */
  removeAllForSession(sessionId: string): Connection[] {
    const set = this.bySession.get(sessionId);
    if (!set) return [];

    const removed: Connection[] = [];
    for (const conn of set) {
      this.byClientId.delete(conn.clientId);
      removed.push(conn);
    }
    this.bySession.delete(sessionId);
    return removed;
  }

  /**
   * Clear all tracked connections.
   */
  clear(): void {
    this.bySession.clear();
    this.byClientId.clear();
  }
}

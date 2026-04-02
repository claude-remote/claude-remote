import type { ClientCommand, HubEvent, HubResponse } from '@/shared/protocol';
import type { SessionSnapshot, WriterStatus, ClientType } from '@/shared/types';
import { CLAUDE_REMOTE_VERSION } from '@/shared/constants';

import type { EventBus } from '@/hub/EventBus';
import type { SessionManager } from '@/hub/SessionManager';
import {
  type ConnectionManager,
  type Connection,
  type WebSocketLike,
} from '@/server/ws/ConnectionManager';
import {
  parseClientCommand,
  validateCommand,
  checkPermission,
  serializeHello,
  serializeSnapshot,
  serializeEvent,
  serializeResponse,
} from '@/server/ws/protocol';

// ── Constants ────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

// ── Types ────────────────────────────────────────────────────────────

export interface WsTicketValidator {
  /**
   * Validate a one-time WS ticket. Returns session info if valid, null otherwise.
   * The ticket is consumed (invalidated) upon successful validation.
   */
  validate(ticket: string): WsTicketPayload | null;
}

export interface WsTicketPayload {
  sessionId: string;
  clientType: ClientType;
  userAgent?: string;
}

export interface WebSocketHandlerDeps {
  sessionManager: SessionManager;
  eventBus: EventBus;
  connectionManager: ConnectionManager;
  ticketValidator: WsTicketValidator;
  /** Override for testing. Defaults to CLAUDE_REMOTE_VERSION. */
  hubVersion?: string;
  /** Override heartbeat intervals for testing (ms). */
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

// ── Handler ──────────────────────────────────────────────────────────

/**
 * Handles a new WebSocket connection through its full lifecycle:
 *   1. Validate WS ticket from query params
 *   2. Send hello + session snapshot
 *   3. Subscribe to EventBus for the session
 *   4. Handle incoming ClientCommands with permission checks
 *   5. Heartbeat: ping every 30s, disconnect if no pong in 10s
 *   6. Clean up on disconnect
 */
export class WebSocketHandler {
  private readonly sessionManager: SessionManager;
  private readonly eventBus: EventBus;
  private readonly connectionManager: ConnectionManager;
  private readonly ticketValidator: WsTicketValidator;
  private readonly hubVersion: string;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;

  /** Active heartbeat interval timers keyed by clientId */
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  /** Active heartbeat timeout timers keyed by clientId */
  private heartbeatTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  /** EventBus unsubscribe functions keyed by clientId */
  private unsubscribers = new Map<string, () => void>();

  constructor(deps: WebSocketHandlerDeps) {
    this.sessionManager = deps.sessionManager;
    this.eventBus = deps.eventBus;
    this.connectionManager = deps.connectionManager;
    this.ticketValidator = deps.ticketValidator;
    this.hubVersion = deps.hubVersion ?? CLAUDE_REMOTE_VERSION;
    this.heartbeatIntervalMs = deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = deps.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  }

  // ── Connection lifecycle ──────────────────────────────────────────

  /**
   * Handle a new incoming WebSocket upgrade.
   * Returns a clientId on success, or null if the ticket is invalid (caller should close the socket).
   */
  handleUpgrade(
    ws: WebSocketLike,
    params: { ticket: string; sessionId?: string },
  ): string | null {
    // 1. Validate ticket
    const payload = this.ticketValidator.validate(params.ticket);
    if (!payload) {
      ws.send(
        serializeResponse({ type: 'error', error: 'invalid or expired ticket' }),
      );
      ws.close(4001, 'invalid ticket');
      return null;
    }

    const sessionId = params.sessionId ?? payload.sessionId;

    // 2. Verify session exists
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      ws.send(
        serializeResponse({ type: 'error', error: `session not found: ${sessionId}` }),
      );
      ws.close(4004, 'session not found');
      return null;
    }

    // 3. Determine writer role
    const existingWriter = this.connectionManager.getWriter(sessionId);
    const role: WriterStatus = existingWriter ? 'standby' : 'active';

    // 4. Register connection
    const clientId = crypto.randomUUID();
    const conn: Connection = {
      ws,
      clientId,
      sessionId,
      role,
      clientType: payload.clientType,
      connectedAt: Date.now(),
      userAgent: payload.userAgent,
      lastPong: Date.now(),
    };

    this.connectionManager.add(conn);

    // If this is the writer, register with SessionManager
    if (role === 'active') {
      this.sessionManager.assignWriter(sessionId, clientId);
    }

    // Touch session (reactivate from idle if needed)
    this.sessionManager.touchSession(sessionId);

    // 5. Send hello
    ws.send(serializeHello(this.hubVersion));

    // 6. Send snapshot
    const snapshot = this.buildSnapshot(sessionId, clientId, role);
    ws.send(serializeSnapshot(snapshot));

    // 7. Subscribe to EventBus
    const unsub = this.eventBus.subscribe(sessionId, (event: HubEvent) => {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(serializeEvent(event));
      }
    });
    this.unsubscribers.set(clientId, unsub);

    // 8. Publish client joined event
    this.eventBus.publish(sessionId, {
      type: 'hub:client:joined',
      sessionId,
      client: {
        id: clientId,
        type: payload.clientType,
        writerStatus: role,
        connectedAt: conn.connectedAt,
        userAgent: payload.userAgent,
      },
    } as any);

    // 9. Start heartbeat
    this.startHeartbeat(clientId, ws);

    return clientId;
  }

  /**
   * Handle an incoming text message from an established connection.
   */
  async handleMessage(clientId: string, raw: string): Promise<void> {
    const conn = this.connectionManager.getByClientId(clientId);
    if (!conn) return;

    // Parse
    const command = parseClientCommand(raw);
    if (!command) {
      conn.ws.send(
        serializeResponse({ type: 'error', error: 'invalid command format' }),
      );
      return;
    }

    // Validate fields
    const validation = validateCommand(command);
    if (!validation.valid) {
      conn.ws.send(
        serializeResponse({
          type: 'error',
          cmdId: command.cmdId,
          error: validation.error!,
        }),
      );
      return;
    }

    // Permission check
    const permError = checkPermission(command, conn.role);
    if (permError) {
      conn.ws.send(
        serializeResponse({
          type: 'error',
          cmdId: command.cmdId,
          error: permError,
        }),
      );
      return;
    }

    // Route command
    const response = await this.routeCommand(conn, command);
    conn.ws.send(serializeResponse(response));
  }

  /**
   * Handle pong receipt from a client (heartbeat response).
   */
  handlePong(clientId: string): void {
    const conn = this.connectionManager.getByClientId(clientId);
    if (conn) {
      conn.lastPong = Date.now();
    }

    // Clear the pending timeout for this client
    const timeout = this.heartbeatTimeouts.get(clientId);
    if (timeout) {
      clearTimeout(timeout);
      this.heartbeatTimeouts.delete(clientId);
    }
  }

  /**
   * Handle client disconnect (close or error).
   */
  handleDisconnect(clientId: string): void {
    const conn = this.connectionManager.remove(clientId);
    if (!conn) return;

    // Stop heartbeat
    this.stopHeartbeat(clientId);

    // Unsubscribe from EventBus
    const unsub = this.unsubscribers.get(clientId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(clientId);
    }

    // Release writer if applicable
    if (conn.role === 'active') {
      this.sessionManager.releaseWriter(conn.sessionId, clientId);

      // Auto-promote next standby to writer
      const standbyConns = this.connectionManager
        .getBySession(conn.sessionId)
        .filter((c) => c.role === 'standby');

      if (standbyConns.length > 0) {
        // Promote the earliest connected standby
        const next = standbyConns.sort(
          (a, b) => a.connectedAt - b.connectedAt,
        )[0]!;
        this.connectionManager.promoteToWriter(next.clientId);
        this.sessionManager.assignWriter(conn.sessionId, next.clientId);

        // Notify about writer change
        this.eventBus.publish(conn.sessionId, {
          type: 'hub:writer:changed',
          sessionId: conn.sessionId,
          newWriterId: next.clientId,
        } as any);
      }
    }

    // Publish client left event
    this.eventBus.publish(conn.sessionId, {
      type: 'hub:client:left',
      sessionId: conn.sessionId,
      clientId,
    } as any);
  }

  // ── Command routing ───────────────────────────────────────────────

  private async routeCommand(
    conn: Connection,
    command: ClientCommand,
  ): Promise<HubResponse> {
    const { sessionId } = conn;

    switch (command.cmd) {
      // Session management
      case 'session:create': {
        const meta = this.sessionManager.createSession({
          cwd: command.cwd,
          name: command.name,
        });
        return { type: 'reply', cmdId: command.cmdId, data: meta };
      }

      case 'session:list': {
        const sessions = this.sessionManager.listSessions();
        return { type: 'reply', cmdId: command.cmdId, data: sessions };
      }

      case 'session:switch': {
        const session = this.sessionManager.getSession(command.sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${command.sessionId}`,
          };
        }
        return { type: 'reply', cmdId: command.cmdId, data: null };
      }

      case 'session:rename': {
        try {
          this.sessionManager.renameSession(sessionId, command.name);
          return { type: 'reply', cmdId: command.cmdId, data: null };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'session:archive': {
        try {
          await this.sessionManager.archiveSession(command.sessionId);
          return { type: 'reply', cmdId: command.cmdId, data: null };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'session:takeOver': {
        // Standby client requests writer takeover
        await this.eventBus.publish(sessionId, {
          type: 'hub:takeOver:request',
          sessionId,
          requesterId: conn.clientId,
          requesterType: conn.clientType,
        } as any);
        return { type: 'reply', cmdId: command.cmdId, data: null };
      }

      case 'session:takeOver:approve': {
        // Current writer approves takeover (find the pending requester)
        return { type: 'reply', cmdId: command.cmdId, data: null };
      }

      case 'session:takeOver:reject': {
        return { type: 'reply', cmdId: command.cmdId, data: null };
      }

      case 'session:releaseWriter': {
        this.sessionManager.releaseWriter(sessionId, conn.clientId);
        conn.role = 'standby';

        // Auto-promote next standby
        const standbyConns = this.connectionManager
          .getBySession(sessionId)
          .filter((c) => c.role === 'standby' && c.clientId !== conn.clientId);

        if (standbyConns.length > 0) {
          const next = standbyConns.sort(
            (a, b) => a.connectedAt - b.connectedAt,
          )[0]!;
          this.connectionManager.promoteToWriter(next.clientId);
          this.sessionManager.assignWriter(sessionId, next.clientId);
        }

        await this.eventBus.publish(sessionId, {
          type: 'hub:writer:changed',
          sessionId,
          newWriterId: this.sessionManager.getActiveWriter(sessionId),
        } as any);

        return { type: 'reply', cmdId: command.cmdId, data: null };
      }

      // Read-only commands — return placeholder acknowledgments
      // In a full implementation these would delegate to the respective subsystems
      case 'context:usage':
      case 'cost:get':
      case 'config:get':
      case 'mcp:list':
      case 'skill:list':
      case 'cwd:favorites':
      case 'cwd:browse':
      case 'file:read':
      case 'file:list':
      case 'file:search':
      case 'history:search':
      case 'chat:export':
        return { type: 'reply', cmdId: command.cmdId, data: null };

      // Write commands that will be wired to subsystems in later tasks
      case 'chat':
      case 'chat:abort':
      case 'control:respond':
      case 'cwd:change':
      case 'cwd:addFavorite':
      case 'skill:invoke':
      case 'config:set':
      case 'mcp:toggle':
      case 'mcp:reconnect':
      case 'chat:branch':
      case 'chat:compact':
      case 'chat:clear':
        return { type: 'reply', cmdId: command.cmdId, data: null };

      default:
        return {
          type: 'error',
          cmdId: (command as any).cmdId,
          error: `unhandled command: ${(command as { cmd: string }).cmd}`,
        };
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────

  private startHeartbeat(clientId: string, ws: WebSocketLike): void {
    const interval = setInterval(() => {
      const conn = this.connectionManager.getByClientId(clientId);
      if (!conn || ws.readyState !== 1 /* OPEN */) {
        this.stopHeartbeat(clientId);
        return;
      }

      // Send ping (as a JSON message; real impl would use WS ping frames)
      ws.send(JSON.stringify({ type: 'ping' }));

      // Set timeout — if no pong within timeout, disconnect
      const timeout = setTimeout(() => {
        this.heartbeatTimeouts.delete(clientId);
        const c = this.connectionManager.getByClientId(clientId);
        if (c) {
          c.ws.close(4008, 'heartbeat timeout');
          this.handleDisconnect(clientId);
        }
      }, this.heartbeatTimeoutMs);

      this.heartbeatTimeouts.set(clientId, timeout);
    }, this.heartbeatIntervalMs);

    this.heartbeatTimers.set(clientId, interval);
  }

  private stopHeartbeat(clientId: string): void {
    const interval = this.heartbeatTimers.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatTimers.delete(clientId);
    }

    const timeout = this.heartbeatTimeouts.get(clientId);
    if (timeout) {
      clearTimeout(timeout);
      this.heartbeatTimeouts.delete(clientId);
    }
  }

  // ── Snapshot builder ──────────────────────────────────────────────

  private buildSnapshot(
    sessionId: string,
    _clientId: string,
    role: WriterStatus,
  ): SessionSnapshot {
    const session = this.sessionManager.getSession(sessionId)!;
    return {
      meta: {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        clientCount: this.connectionManager.countBySession(sessionId),
        hasActiveWriter: this.connectionManager.getWriter(sessionId) !== null,
      },
      recentMessages: session.messages.slice(-50),
      activeTasks: session.tasks.filter(
        (t) => t.status === 'pending' || t.status === 'in_progress',
      ),
      pendingPermissions: session.pendingPermissions,
      clients: this.connectionManager.getBySession(sessionId).map((c) => ({
        id: c.clientId,
        type: c.clientType,
        writerStatus: c.role,
        connectedAt: c.connectedAt,
        userAgent: c.userAgent,
      })),
      availableSkills: [],
      config: {
        model: 'claude-sonnet-4-20250514',
        effortLevel: 'high',
        permissionMode: 'ask',
      },
      configOptions: {
        availableModels: [],
        effortLevels: ['low', 'medium', 'high'],
        permissionModes: ['ask', 'approve', 'bypass'],
      },
      contextUsage: { usedTokens: 0, maxTokens: 200000, percentage: 0, breakdown: [] },
      costSummary: {
        sessionCost: 0,
        formattedCost: '$0.00',
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        sessionDuration: 0,
      },
      mcpServers: [],
      myWriterStatus: role,
      lastSeq: this.eventBus.getSeq(sessionId),
    };
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  /**
   * Tear down all connections and timers. Called on Hub shutdown.
   */
  destroy(): void {
    for (const [clientId] of this.heartbeatTimers) {
      this.stopHeartbeat(clientId);
    }
    for (const unsub of this.unsubscribers.values()) {
      unsub();
    }
    this.unsubscribers.clear();
  }
}

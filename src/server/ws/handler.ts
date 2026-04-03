import { CLAUDE_REMOTE_VERSION } from '@/shared/constants';
import type { ClientCommand, HubEvent, HubResponse } from '@/shared/protocol';
import type { ClientType, SessionSnapshot, WriterStatus } from '@/shared/types';

import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readFileContent } from '@/server/files/readFileContent';
import { searchFiles } from '@/server/files/searchFiles';
import type { EventBus } from '@/hub/EventBus';
import type { Hub } from '@/hub/Hub';
import type { SessionManager } from '@/hub/SessionManager';
import { listEntries } from '@/server/files/listEntries';
import { validatePath } from '@/server/files/pathValidator';
import type { Connection, ConnectionManager, WebSocketLike } from '@/server/ws/ConnectionManager';
import {
  checkPermission,
  parseClientCommand,
  serializeEvent,
  serializeHello,
  serializeResponse,
  serializeSnapshot,
  validateCommand,
} from '@/server/ws/protocol';

// ── Constants ────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

function getMessageText(message: SessionSnapshot['recentMessages'][number]): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') {
        return block.text;
      }
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        return block.content;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

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
  hub?: Hub;
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
  private readonly hub?: Hub;
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
    this.hub = deps.hub;
    this.hubVersion = deps.hubVersion ?? CLAUDE_REMOTE_VERSION;
    this.heartbeatIntervalMs = deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = deps.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  }

  // ── Connection lifecycle ──────────────────────────────────────────

  /**
   * Handle a new incoming WebSocket upgrade.
   * Returns a clientId on success, or null if the ticket is invalid (caller should close the socket).
   */
  handleUpgrade(ws: WebSocketLike, params: { ticket: string; sessionId?: string }): string | null {
    // 1. Validate ticket
    const payload = this.ticketValidator.validate(params.ticket);
    if (!payload) {
      ws.send(serializeResponse({ type: 'error', error: 'invalid or expired ticket' }));
      ws.close(4001, 'invalid ticket');
      return null;
    }

    const sessionId = params.sessionId ?? payload.sessionId;

    // 2. Verify session exists
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      ws.send(serializeResponse({ type: 'error', error: `session not found: ${sessionId}` }));
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
      conn.ws.send(serializeResponse({ type: 'error', error: 'invalid command format' }));
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
        const next = standbyConns.sort((a, b) => a.connectedAt - b.connectedAt)[0]!;
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

  private async routeCommand(conn: Connection, command: ClientCommand): Promise<HubResponse> {
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
          const next = standbyConns.sort((a, b) => a.connectedAt - b.connectedAt)[0]!;
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
      case 'context:usage': {
        const snapshot = this.sessionManager.getSnapshot(sessionId, conn.clientId);
        return { type: 'reply', cmdId: command.cmdId, data: snapshot.contextUsage };
      }

      case 'cost:get': {
        const snapshot = this.sessionManager.getSnapshot(sessionId, conn.clientId);
        return { type: 'reply', cmdId: command.cmdId, data: snapshot.costSummary };
      }

      case 'config:get': {
        const snapshot = this.sessionManager.getSnapshot(sessionId, conn.clientId);
        return {
          type: 'reply',
          cmdId: command.cmdId,
          data: {
            config: snapshot.config,
            options: snapshot.configOptions,
          },
        };
      }

      case 'mcp:list': {
        const snapshot = this.sessionManager.getSnapshot(sessionId, conn.clientId);
        return { type: 'reply', cmdId: command.cmdId, data: snapshot.mcpServers };
      }

      case 'skill:list': {
        const snapshot = this.sessionManager.getSnapshot(sessionId, conn.clientId);
        return { type: 'reply', cmdId: command.cmdId, data: { skills: snapshot.availableSkills } };
      }

      case 'cwd:favorites': {
        const snapshot = this.sessionManager.getSnapshot(sessionId, conn.clientId);
        // Favorites are stored at the session level; return from snapshot or empty
        return {
          type: 'reply',
          cmdId: command.cmdId,
          data: { favorites: (snapshot as any).favorites ?? [] },
        };
      }

      case 'cwd:browse': {
        const session = this.sessionManager.getSession(conn.sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${conn.sessionId}`,
          };
        }

        let safePath: string;
        try {
          safePath = validatePath(command.path, [session.cwd]);
        } catch {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: 'path not allowed: outside session working directory',
          };
        }

        try {
          const dirs = readdirSync(safePath, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(safePath, entry.name))
            .sort((a, b) => basename(a).localeCompare(basename(b)));
          return {
            type: 'reply',
            cmdId: command.cmdId,
            data: { path: safePath, dirs },
          };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'file:search': {
        const session = this.sessionManager.getSession(conn.sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${conn.sessionId}`,
          };
        }

        const searchPath = command.path ?? session.cwd;
        try {
          const result = searchFiles(command.pattern, searchPath, [session.cwd]);
          return {
            type: 'reply',
            cmdId: command.cmdId,
            data: { ...result } as Record<string, unknown>,
          };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'file:read': {
        const offset = command.offset ?? 0;
        const limit = command.limit ?? 200;
        const session = this.sessionManager.getSession(conn.sessionId);

        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${conn.sessionId}`,
          };
        }

        let safePath: string;
        try {
          safePath = validatePath(command.path, [session.cwd]);
        } catch {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: 'path not allowed: outside session working directory',
          };
        }

        try {
          return {
            type: 'reply',
            cmdId: command.cmdId,
            data: readFileContent(safePath, offset, limit) as Record<string, unknown>,
          };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'file:list': {
        const session = this.sessionManager.getSession(conn.sessionId);

        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${conn.sessionId}`,
          };
        }

        let safePath: string;
        try {
          safePath = validatePath(command.path, [session.cwd]);
        } catch {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: 'path not allowed: outside session working directory',
          };
        }

        try {
          return {
            type: 'reply',
            cmdId: command.cmdId,
            data: {
              path: safePath,
              entries: listEntries(safePath),
            },
          };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'chat:export': {
        const session = this.sessionManager.getSession(conn.sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: 'Session not found',
          };
        }

        const filename = `session-${session.id}.${command.format === 'json' ? 'json' : 'md'}`;
        const content =
          command.format === 'json'
            ? JSON.stringify(session, null, 2)
            : [
                `# ${session.name}`,
                '',
                `- Session ID: ${session.id}`,
                `- CWD: ${session.cwd}`,
                `- Status: ${session.status}`,
                '',
                ...session.messages.flatMap((message) => [
                  `## ${message.role} @ ${new Date(message.createdAt).toISOString()}`,
                  '',
                  ...message.content.map((block) => {
                    if (block.type === 'text') {
                      return `**${message.role}**: ${block.text}`;
                    }

                    return `**${message.role}**: [${block.type}]`;
                  }),
                  '',
                ]),
              ].join('\n');

        return {
          type: 'reply',
          cmdId: command.cmdId,
          data: {
            sessionId: session.id,
            content,
            format: command.format,
            filename,
          },
        };
      }

      case 'history:search': {
        const session = this.sessionManager.getSession(sessionId);
        const normalizedQuery = command.query.trim().toLowerCase();
        const limit = command.limit ?? 20;
        const results =
          session?.messages
            .map((message) => {
              const text = getMessageText(message);
              if (!text || !text.toLowerCase().includes(normalizedQuery)) {
                return null;
              }
              return {
                sessionId,
                sessionName: session.name,
                messageId: message.id,
                role: message.role === 'assistant' ? 'assistant' : 'user',
                snippet: text,
                timestamp: message.createdAt,
              };
            })
            .filter((result) => result !== null)
            .slice(0, limit) ?? [];
        return {
          type: 'reply',
          cmdId: command.cmdId,
          data: {
            query: command.query,
            scope: command.scope,
            limit,
            results,
          },
        };
      }

      case 'mcp:toggle': {
        if (!this.hub) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: 'hub not available',
          };
        }

        const server = this.hub.toggleMcpServer(command.serverId, command.enabled);
        if (!server) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `MCP server '${command.serverId}' not found`,
          };
        }

        return { type: 'reply', cmdId: command.cmdId, data: { ...server } };
      }

      case 'mcp:reconnect': {
        if (!this.hub) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: 'hub not available',
          };
        }

        const server = this.hub.reconnectMcpServer(command.serverId);
        if (!server) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `MCP server '${command.serverId}' not found`,
          };
        }

        return { type: 'reply', cmdId: command.cmdId, data: { ...server } };
      }

      case 'cwd:change': {
        try {
          const stats = statSync(command.path);
          if (!stats.isDirectory()) {
            return {
              type: 'error',
              cmdId: command.cmdId,
              error: `not a directory: ${command.path}`,
            };
          }
        } catch {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `directory not accessible: ${command.path}`,
          };
        }

        try {
          this.sessionManager.switchCwd(sessionId, command.path);
          return { type: 'reply', cmdId: command.cmdId, data: { cwd: command.path } };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'cwd:addFavorite': {
        const favoriteId = `fav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          return {
            type: 'reply',
            cmdId: command.cmdId,
            data: {
              id: favoriteId,
              path: command.path,
              label: command.label ?? command.path,
            },
          };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'skill:invoke': {
        if (!this.hub) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: 'hub not available',
          };
        }

        const result = this.hub.invokeSkill(command.name, command.args, sessionId);
        if (result === null) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `skill not found: ${command.name}`,
          };
        }
        if (result === undefined) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${sessionId}`,
          };
        }

        return { type: 'reply', cmdId: command.cmdId, data: result };
      }

      case 'chat': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${sessionId}`,
          };
        }

        // Build user message
        const now = Date.now();
        const messageId = `msg-${now}-${Math.random().toString(36).slice(2, 6)}`;
        const userMessage = {
          id: messageId,
          role: 'user' as const,
          content: [{ type: 'text' as const, text: command.text }],
          createdAt: now,
          updatedAt: now,
        };

        // Append to session messages
        session.messages.push(userMessage);
        session.updatedAt = now;

        // Publish status change
        await this.eventBus.publish(sessionId, {
          type: 'hub:session:statusChanged',
          sessionId,
          status: 'active',
        } as any);

        // Fire sendChat in background (non-blocking)
        if (this.hub) {
          const config = this.sessionManager.getConfig(sessionId);
          this.hub.sendChat(sessionId, command.text, config ?? undefined).catch(() => {
            // Errors are published via EventBus by ClaudeClient
          });
        }

        return { type: 'reply', cmdId: command.cmdId, data: { messageId } };
      }

      case 'chat:clear': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${sessionId}`,
          };
        }

        session.messages = [];
        session.updatedAt = Date.now();

        await this.eventBus.publish(sessionId, {
          type: 'hub:chat:cleared',
          sessionId,
        } as any);

        return { type: 'reply', cmdId: command.cmdId, data: { ok: true } };
      }

      case 'chat:compact': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${sessionId}`,
          };
        }

        if (!this.hub) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: 'hub not available',
          };
        }

        try {
          const config = this.sessionManager.getConfig(sessionId) ?? {
            model: 'claude-sonnet-4-20250514',
            effortLevel: 'medium' as const,
            permissionMode: 'ask' as const,
          };
          const compacted = await this.hub.getClaudeClient().compact(sessionId, session.messages, config);
          session.messages = compacted;
          session.updatedAt = Date.now();

          await this.eventBus.publish(sessionId, {
            type: 'hub:chat:compacted',
            sessionId,
          } as any);

          return {
            type: 'reply',
            cmdId: command.cmdId,
            data: { ok: true, messageCount: compacted.length },
          };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

      case 'chat:branch': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${sessionId}`,
          };
        }

        const branchIdx = session.messages.findIndex((m) => m.id === command.messageId);
        if (branchIdx === -1) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `message not found: ${command.messageId}`,
          };
        }

        const branchedMessages = session.messages.slice(0, branchIdx + 1);
        const newMeta = this.sessionManager.createSession({
          cwd: session.cwd,
          name: command.name ?? `branch-${session.name}`,
        });

        // Copy messages into the new session
        const newSession = this.sessionManager.getSession(newMeta.id);
        if (newSession) {
          newSession.messages = branchedMessages.map((m) => ({ ...m }));
        }

        await this.eventBus.publish(sessionId, {
          type: 'hub:chat:branched',
          sessionId,
          newSessionId: newMeta.id,
        } as any);

        return { type: 'reply', cmdId: command.cmdId, data: newMeta };
      }

      case 'chat:abort': {
        if (this.hub) {
          await this.hub.abortChat(sessionId);
        }

        this.eventBus.publish(sessionId, {
          type: 'hub:session:statusChanged',
          sessionId,
          status: 'interrupted',
        } as any);

        return { type: 'reply', cmdId: command.cmdId, data: { ok: true } };
      }

      case 'control:respond': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `session not found: ${sessionId}`,
          };
        }

        // Find the pending permission request
        const permIdx = session.pendingPermissions.findIndex(
          (p) => p.id === command.requestId,
        );
        if (permIdx === -1) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: `permission request not found: ${command.requestId}`,
          };
        }

        // Remove from pending
        const [perm] = session.pendingPermissions.splice(permIdx, 1);

        // Publish the control response event
        await this.eventBus.publish(sessionId, {
          type: 'sdk:control:response',
          sessionId,
          requestId: command.requestId,
          toolName: perm!.toolName,
          payload: command.response,
        } as any);

        return { type: 'reply', cmdId: command.cmdId, data: { ok: true } };
      }

      case 'config:set': {
        try {
          const updated = this.sessionManager.updateConfig(sessionId, command.patch);
          await this.eventBus.publish(sessionId, {
            type: 'hub:config:changed',
            sessionId,
            config: updated,
          } as any);

          return {
            type: 'reply',
            cmdId: command.cmdId,
            data: {
              ok: true,
              sessionId,
              updated,
            },
          };
        } catch (err) {
          return {
            type: 'error',
            cmdId: command.cmdId,
            error: (err as Error).message,
          };
        }
      }

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

  private buildSnapshot(sessionId: string, _clientId: string, role: WriterStatus): SessionSnapshot {
    const snapshot = this.sessionManager.getSnapshot(sessionId, _clientId);
    return {
      ...snapshot,
      meta: {
        ...snapshot.meta,
        clientCount: this.connectionManager.countBySession(sessionId),
        hasActiveWriter: this.connectionManager.getWriter(sessionId) !== null,
      },
      clients: this.connectionManager.getBySession(sessionId).map((c) => ({
        id: c.clientId,
        type: c.clientType,
        writerStatus: c.role,
        connectedAt: c.connectedAt,
        userAgent: c.userAgent,
      })),
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

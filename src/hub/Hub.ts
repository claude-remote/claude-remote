import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import { ClaudeClient, type ClaudeClientDeps } from '@/hub/ClaudeClient';
import { DEFAULT_HUB_CONFIG } from '@/hub/config';
import { EventBus } from '@/hub/EventBus';
import { SessionManager } from '@/hub/SessionManager';
import { ToolEngine, type ToolEngineDeps } from '@/hub/ToolEngine';
import type { SqliteStore } from '@/hub/store/SqliteStore';
import type {
  ConfigOptions,
  McpServerInfo,
  Message,
  SessionConfig,
  SkillInfo,
  SessionSnapshot,
} from '@/shared/types';
import {
  type ClientCommand,
  type HubClientInfo,
  type HubResponse,
  type Session,
  createNotImplementedChatError,
} from './HubProtocol.js';
import { LocalSocketServer } from './LocalSocketServer.js';
import { SessionRegistry } from './SessionRegistry.js';

type HubOptions = {
  socketPath: string;
  sessionManager?: SessionManager;
  claudeClient?: ClaudeClient;
  eventBus?: EventBus;
  toolEngine?: ToolEngine;
  apiKey?: string;
};

type WebConfig = {
  port: number;
  tunnel: boolean;
  maxSessions: number;
  maxConcurrentTools: number;
};

function createDefaultConfigOptions(): ConfigOptions {
  return {
    availableModels: [
      { id: 'claude-sonnet', name: 'Claude Sonnet', supportsImages: true },
      { id: 'claude-opus', name: 'Claude Opus', supportsImages: true },
      { id: 'claude-haiku', name: 'Claude Haiku', supportsImages: true },
    ],
    effortLevels: ['low', 'medium', 'high'],
    permissionModes: ['ask', 'approve', 'bypass'],
  };
}

function createDefaultSkills(): SkillInfo[] {
  return [
    {
      name: 'commit',
      description: 'Create a git commit from staged changes',
      aliases: ['ci'],
      userInvocable: true,
      arguments: ['message'],
      source: 'bundled',
    },
    {
      name: 'review',
      description: 'Review the current diff for bugs and risks',
      userInvocable: true,
      source: 'bundled',
    },
  ];
}

function createNoopStore(): SqliteStore {
  return {
    saveSession() {},
  } as unknown as SqliteStore;
}

export class Hub {
  private readonly registry = new SessionRegistry();
  private readonly mcpServers = new Map<string, McpServerInfo>();
  private readonly sessionManager: SessionManager;
  private readonly eventBus: EventBus;
  private readonly toolEngine: ToolEngine;
  private readonly claudeClient: ClaudeClient;
  private readonly socketServer: LocalSocketServer;
  private readonly skills: SkillInfo[] = createDefaultSkills();
  private readonly sockets = new Set<Socket>();
  private globalConfig: WebConfig = {
    port: DEFAULT_HUB_CONFIG.port,
    tunnel: DEFAULT_HUB_CONFIG.tunnelAutoStart,
    maxSessions: DEFAULT_HUB_CONFIG.maxSessions,
    maxConcurrentTools: DEFAULT_HUB_CONFIG.maxConcurrentTools,
  };
  private running = false;

  constructor(private readonly options: HubOptions) {
    this.eventBus = options.eventBus ?? new EventBus();

    const noopStore = createNoopStore();
    this.sessionManager =
      options.sessionManager ??
      new SessionManager(noopStore, this.eventBus, {
        maxSessions: DEFAULT_HUB_CONFIG.maxSessions,
      });

    const toolEngineDeps: ToolEngineDeps = {
      store: {
        createToolExecution() {},
        updateToolExecution() {},
      },
      eventBus: this.eventBus,
    };
    this.toolEngine = options.toolEngine ?? new ToolEngine(toolEngineDeps, {
      maxConcurrent: DEFAULT_HUB_CONFIG.maxConcurrentTools,
    });

    this.claudeClient = options.claudeClient ?? new ClaudeClient({
      eventBus: this.eventBus,
      toolEngine: this.toolEngine,
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    });

    this.socketServer = new LocalSocketServer(options.socketPath, (socket) =>
      this.handleConnection(socket),
    );
  }

  async start(): Promise<void> {
    await this.socketServer.start();
    this.running = true;
  }

  getStatus() {
    return {
      running: this.running,
      sessionCount: this.registry.listSessions().length,
      connectionCount: this.sockets.size,
      socketPath: this.options.socketPath,
    };
  }

  listSessions(): Session[] {
    return this.registry.listSessions();
  }

  createSession(input: { cwd: string; name?: string }): Session {
    const session = this.registry.createSession(input);
    this.ensureSessionManagerSession(session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.registry.getSession(sessionId);
  }

  archiveSession(sessionId: string): Session | undefined {
    return this.registry.archiveSession(sessionId);
  }

  updateSession(
    sessionId: string,
    updates: {
      name?: string;
      tags?: string[];
    },
  ): Session | undefined {
    return this.registry.updateSession(sessionId, updates);
  }

  appendMessage(sessionId: string, message: Message): Session | undefined {
    return this.registry.appendMessage(sessionId, message);
  }

  /** Send a chat message to Claude and stream the response via EventBus. */
  async sendChat(
    sessionId: string,
    text: string,
    config?: Partial<SessionConfig>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = this.registry.getSession(sessionId);
    if (!session) {
      return { ok: false, error: `session ${sessionId} not found` };
    }

    // Build and append user message
    const now = Date.now();
    const userMessage: Message = {
      id: `msg-${now}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: [{ type: 'text', text }],
      createdAt: now,
      updatedAt: now,
    };
    this.registry.appendMessage(sessionId, userMessage);

    // Resolve config
    this.ensureSessionManagerSession(session);
    const sessionConfig = this.sessionManager.getConfig(sessionId);
    const mergedConfig: SessionConfig = {
      ...(sessionConfig ?? {
        model: 'claude-sonnet-4-20250514',
        effortLevel: 'medium' as const,
        permissionMode: 'ask' as const,
      }),
      ...config,
    };

    // Get updated session with the user message
    const updatedSession = this.registry.getSession(sessionId)!;

    try {
      await this.claudeClient.sendMessage({
        sessionId,
        messages: updatedSession.messages,
        config: mergedConfig,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Abort an in-flight chat for a session. */
  async abortChat(sessionId: string): Promise<void> {
    await this.claudeClient.abort(sessionId);
  }

  /** Get the ClaudeClient instance (for WS handler integration). */
  getClaudeClient(): ClaudeClient {
    return this.claudeClient;
  }

  /** Get the ToolEngine instance. */
  getToolEngine(): ToolEngine {
    return this.toolEngine;
  }

  /** Get the EventBus instance. */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  getSessionConfig(sessionId: string): SessionConfig | undefined {
    const session = this.registry.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    this.ensureSessionManagerSession(session);
    return this.sessionManager.getConfig(sessionId) ?? undefined;
  }

  updateSessionConfig(sessionId: string, updates: Partial<SessionConfig>): SessionConfig | undefined {
    const session = this.registry.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    this.ensureSessionManagerSession(session);
    const updated = this.sessionManager.updateConfig(sessionId, updates);
    this.registry.updateSession(sessionId, {});
    return updated;
  }

  getGlobalConfig(): WebConfig {
    return this.globalConfig;
  }

  updateGlobalConfig(updates: Partial<WebConfig>): WebConfig {
    this.globalConfig = {
      ...this.globalConfig,
      ...updates,
    };
    return this.globalConfig;
  }

  listMcpServers(): McpServerInfo[] {
    return Array.from(this.mcpServers.values());
  }

  getMcpServer(name: string): McpServerInfo | undefined {
    return this.mcpServers.get(name);
  }

  reconnectMcpServer(name: string): McpServerInfo | undefined {
    const server = this.mcpServers.get(name);
    if (!server) {
      return undefined;
    }

    const updated = {
      ...server,
      status: 'connected',
      error: undefined,
    } satisfies McpServerInfo;
    this.mcpServers.set(name, updated);
    return updated;
  }

  toggleMcpServer(name: string, enabled: boolean): McpServerInfo | undefined {
    const server = this.mcpServers.get(name);
    if (!server) {
      return undefined;
    }

    const updated = {
      ...server,
      enabled,
      status: enabled ? 'connected' : 'disconnected',
    } satisfies McpServerInfo;
    this.mcpServers.set(name, updated);
    return updated;
  }

  listSkills(): SkillInfo[] {
    return [...this.skills];
  }

  getSessionSkills(sessionId: string): SkillInfo[] | undefined {
    if (!this.registry.getSession(sessionId)) {
      return undefined;
    }
    return this.listSkills();
  }

  invokeSkill(name: string, args?: string, sessionId?: string) {
    const skill = this.skills.find((item) => item.name === name || item.aliases?.includes(name));
    if (!skill) {
      return null;
    }
    if (sessionId && !this.registry.getSession(sessionId)) {
      return undefined;
    }

    return {
      ok: true,
      skill: skill.name,
      args: args ?? null,
      sessionId: sessionId ?? null,
      status: 'queued' as const,
    };
  }

  getSessionSnapshot(sessionId: string): SessionSnapshot | null {
    const session = this.registry.getSession(sessionId);
    if (!session) {
      return null;
    }

    this.ensureSessionManagerSession(session);
    const config = this.sessionManager.getConfig(session.id);
    if (!config) {
      return null;
    }

    return {
      meta: {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        clientCount: session.clients.length,
        hasActiveWriter: session.clients.length > 0,
        tags: session.tags ?? [],
      },
      recentMessages: session.messages,
      activeTasks: session.tasks,
      pendingPermissions: session.pendingPermissions ?? [],
      clients: session.clients.map((client, index) => ({
        id: client.id,
        type: client.type,
        writerStatus: index === 0 ? 'active' : 'standby',
        connectedAt: client.connectedAt,
      })),
      availableSkills: this.listSkills(),
      config,
      configOptions: createDefaultConfigOptions(),
      contextUsage: {
        usedTokens: 0,
        maxTokens: 200000,
        percentage: 0,
        breakdown: [],
      },
      costSummary: {
        sessionCost: 0,
        formattedCost: '$0.00',
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        sessionDuration: 0,
      },
      mcpServers: this.listMcpServers(),
      myWriterStatus: session.clients.length > 0 ? 'active' : 'standby',
      lastSeq: 0,
    };
  }

  private ensureSessionManagerSession(session: Session): void {
    this.sessionManager.ensureSession({
      id: session.id,
      cwd: session.cwd,
      name: session.name,
    });
  }

  async stop(): Promise<void> {
    this.claudeClient.shutdown();
    await this.toolEngine.shutdown();
    await this.socketServer.stop();
    this.running = false;
  }

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket);
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      while (buffer.includes('\n')) {
        const newlineIndex = buffer.indexOf('\n');
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        this.handleCommand(socket, line);
      }
    });

    const cleanup = () => {
      this.sockets.delete(socket);
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  }

  private handleCommand(socket: Socket, rawCommand: string): void {
    let command: ClientCommand;

    try {
      command = JSON.parse(rawCommand) as ClientCommand;
    } catch {
      this.writeResponse(socket, {
        type: 'error',
        cmdId: 'unknown',
        error: 'invalid json payload',
      });
      return;
    }

    switch (command.cmd) {
      case 'session:create': {
        const session = this.createSession({
          cwd: command.cwd,
          name: command.name,
        });
        this.writeResponse(socket, {
          type: 'reply',
          cmdId: command.cmdId,
          data: session,
        });
        return;
      }
      case 'session:list':
        this.writeResponse(socket, {
          type: 'reply',
          cmdId: command.cmdId,
          data: this.listSessions(),
        });
        return;
      case 'session:attach': {
        const session = this.registry.attachClient(command.sessionId, {
          id: randomUUID(),
          type: 'tui',
          connectedAt: Date.now(),
        } satisfies HubClientInfo);

        if (!session) {
          this.writeResponse(socket, {
            type: 'error',
            cmdId: command.cmdId,
            error: `session ${command.sessionId} not found`,
          });
          return;
        }

        this.writeResponse(socket, {
          type: 'snapshot',
          session,
        });
        return;
      }
      case 'chat':
        this.writeResponse(socket, createNotImplementedChatError(command.cmdId));
        return;
      case 'hub:status':
        this.writeResponse(socket, {
          type: 'reply',
          cmdId: command.cmdId,
          data: this.getStatus(),
        });
        return;
    }
  }

  private writeResponse(socket: Socket, response: HubResponse | Record<string, unknown>): void {
    socket.write(`${JSON.stringify(response)}\n`);
  }
}

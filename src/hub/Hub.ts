import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import { DEFAULT_HUB_CONFIG } from '@/hub/config';
import type { ConfigOptions, Message, SessionConfig, SessionSnapshot } from '@/shared/types';
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
};

type WebConfig = {
  port: number;
  tunnel: boolean;
  maxSessions: number;
  maxConcurrentTools: number;
};

function createDefaultSessionConfig(): SessionConfig {
  return {
    model: 'claude-sonnet',
    effortLevel: 'medium',
    permissionMode: 'ask',
  };
}

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

export class Hub {
  private readonly registry = new SessionRegistry();
  private readonly socketServer: LocalSocketServer;
  private readonly sessionConfigs = new Map<string, SessionConfig>();
  private readonly sockets = new Set<Socket>();
  private globalConfig: WebConfig = {
    port: DEFAULT_HUB_CONFIG.port,
    tunnel: DEFAULT_HUB_CONFIG.tunnelAutoStart,
    maxSessions: DEFAULT_HUB_CONFIG.maxSessions,
    maxConcurrentTools: DEFAULT_HUB_CONFIG.maxConcurrentTools,
  };
  private running = false;

  constructor(private readonly options: HubOptions) {
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
    this.sessionConfigs.set(session.id, createDefaultSessionConfig());
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

  getSessionConfig(sessionId: string): SessionConfig | undefined {
    if (!this.registry.getSession(sessionId)) {
      return undefined;
    }
    return this.sessionConfigs.get(sessionId) ?? createDefaultSessionConfig();
  }

  updateSessionConfig(sessionId: string, updates: Partial<SessionConfig>): SessionConfig | undefined {
    if (!this.registry.getSession(sessionId)) {
      return undefined;
    }

    const updated = {
      ...this.getSessionConfig(sessionId),
      ...updates,
    };
    this.sessionConfigs.set(sessionId, updated);
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

  getSessionSnapshot(sessionId: string): SessionSnapshot | null {
    const session = this.registry.getSession(sessionId);
    if (!session) {
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
      availableSkills: [],
      config: this.getSessionConfig(session.id) ?? createDefaultSessionConfig(),
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
      mcpServers: [],
      myWriterStatus: session.clients.length > 0 ? 'active' : 'standby',
      lastSeq: 0,
    };
  }

  async stop(): Promise<void> {
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
        code: 'bad_request',
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
            code: 'not_found',
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

  private writeResponse(socket: Socket, response: HubResponse): void {
    socket.write(`${JSON.stringify(response)}\n`);
  }
}

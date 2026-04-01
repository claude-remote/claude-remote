import { randomUUID } from 'crypto'
import type { Socket } from 'net'
import {
  createNotImplementedChatError,
  type ClientCommand,
  type HubClientInfo,
  type HubResponse,
} from './HubProtocol.js'
import { LocalSocketServer } from './LocalSocketServer.js'
import { SessionRegistry } from './SessionRegistry.js'

type HubOptions = {
  socketPath: string
}

export class Hub {
  private readonly registry = new SessionRegistry()
  private readonly socketServer: LocalSocketServer
  private readonly sockets = new Set<Socket>()
  private running = false

  constructor(private readonly options: HubOptions) {
    this.socketServer = new LocalSocketServer(
      options.socketPath,
      socket => this.handleConnection(socket),
    )
  }

  async start(): Promise<void> {
    await this.socketServer.start()
    this.running = true
  }

  getStatus() {
    return {
      running: this.running,
      sessionCount: this.registry.listSessions().length,
      connectionCount: this.sockets.size,
      socketPath: this.options.socketPath,
    }
  }

  async stop(): Promise<void> {
    await this.socketServer.stop()
    this.running = false
  }

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket)
    let buffer = ''

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')

      while (buffer.includes('\n')) {
        const newlineIndex = buffer.indexOf('\n')
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)

        if (!line) {
          continue
        }

        this.handleCommand(socket, line)
      }
    })

    const cleanup = () => {
      this.sockets.delete(socket)
    }

    socket.on('close', cleanup)
    socket.on('error', cleanup)
  }

  private handleCommand(socket: Socket, rawCommand: string): void {
    let command: ClientCommand

    try {
      command = JSON.parse(rawCommand) as ClientCommand
    } catch {
      this.writeResponse(socket, {
        type: 'error',
        cmdId: 'unknown',
        code: 'bad_request',
        error: 'invalid json payload',
      })
      return
    }

    switch (command.cmd) {
      case 'session:create': {
        const session = this.registry.createSession({
          cwd: command.cwd,
          name: command.name,
        })
        this.writeResponse(socket, {
          type: 'reply',
          cmdId: command.cmdId,
          data: session,
        })
        return
      }
      case 'session:list':
        this.writeResponse(socket, {
          type: 'reply',
          cmdId: command.cmdId,
          data: this.registry.listSessions(),
        })
        return
      case 'session:attach': {
        const session = this.registry.attachClient(command.sessionId, {
          id: randomUUID(),
          type: 'tui',
          connectedAt: Date.now(),
        } satisfies HubClientInfo)

        if (!session) {
          this.writeResponse(socket, {
            type: 'error',
            cmdId: command.cmdId,
            code: 'not_found',
            error: `session ${command.sessionId} not found`,
          })
          return
        }

        this.writeResponse(socket, {
          type: 'snapshot',
          session,
        })
        return
      }
      case 'chat':
        this.writeResponse(socket, createNotImplementedChatError(command.cmdId))
        return
      case 'hub:status':
        this.writeResponse(socket, {
          type: 'reply',
          cmdId: command.cmdId,
          data: this.getStatus(),
        })
        return
    }
  }

  private writeResponse(socket: Socket, response: HubResponse): void {
    socket.write(`${JSON.stringify(response)}\n`)
  }
}

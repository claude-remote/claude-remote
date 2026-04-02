import net, { type Socket } from 'net'
import type { HubResponse, Session, Snapshot } from '../HubProtocol.js'
import type { HubConnectionState } from './HubConnectionState.js'

type HubClientOptions = {
  socketPath: string
}

type PendingEntry =
  | {
      kind: 'response'
      resolve: (response: HubResponse) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'snapshot'
      resolve: (snapshot: Snapshot) => void
      reject: (error: Error) => void
    }

export class HubClient {
  private socket: Socket | null = null
  private connectionState: HubConnectionState = 'disconnected'
  private nextCommandId = 0
  private buffer = ''
  private readonly pending = new Map<string, PendingEntry>()

  constructor(private readonly options: HubClientOptions) {}

  getConnectionState(): HubConnectionState {
    return this.connectionState
  }

  async connect(): Promise<void> {
    if (this.socket) {
      return
    }

    this.connectionState = 'connecting'
    this.socket = net.createConnection(this.options.socketPath)
    this.socket.on('data', chunk => this.handleData(chunk.toString('utf8')))
    this.socket.on('close', () => {
      this.connectionState = 'disconnected'
      this.socket = null
    })

    await new Promise<void>((resolve, reject) => {
      this.socket!.once('connect', () => {
        this.connectionState = 'connected'
        resolve()
      })
      this.socket!.once('error', error => {
        this.connectionState = 'disconnected'
        reject(error)
      })
    })
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      this.connectionState = 'disconnected'
      return
    }

    const socket = this.socket
    this.socket = null
    this.connectionState = 'disconnected'

    await new Promise<void>(resolve => {
      socket.once('close', () => resolve())
      socket.end()
    })
  }

  async createSession(input: {
    cwd: string
    name?: string
  }): Promise<Session> {
    const response = await this.sendCommand({
      cmd: 'session:create',
      cwd: input.cwd,
      name: input.name,
    })

    if (response.type !== 'reply') {
      throw new Error('expected session:create reply')
    }

    return response.data as Session
  }

  async listSessions(): Promise<Session[]> {
    const response = await this.sendCommand({
      cmd: 'session:list',
    })

    if (response.type !== 'reply') {
      throw new Error('expected session:list reply')
    }

    return response.data as Session[]
  }

  async attachSession(sessionId: string): Promise<Snapshot> {
    return this.sendSnapshotCommand({
      cmd: 'session:attach',
      sessionId,
    })
  }

  async sendChat(text: string): Promise<HubResponse> {
    return this.sendCommand({
      cmd: 'chat',
      text,
    })
  }

  private sendCommand(
    command:
      | { cmd: 'session:create'; cwd: string; name?: string }
      | { cmd: 'session:list' }
      | { cmd: 'chat'; text: string },
  ): Promise<HubResponse> {
    return this.writeCommand(command, 'response')
  }

  private sendSnapshotCommand(command: {
    cmd: 'session:attach'
    sessionId: string
  }): Promise<Snapshot> {
    return this.writeCommand(command, 'snapshot')
  }

  private writeCommand(
    command: object,
    kind: PendingEntry['kind'],
  ): Promise<any> {
    if (!this.socket) {
      throw new Error('hub client is not connected')
    }

    const cmdId = `cmd-${++this.nextCommandId}`

    return new Promise((resolve, reject) => {
      this.pending.set(cmdId, {
        kind,
        resolve,
        reject,
      } as PendingEntry)

      this.socket!.write(`${JSON.stringify({ ...command, cmdId })}\n`)
    })
  }

  private handleData(chunk: string): void {
    this.buffer += chunk

    while (this.buffer.includes('\n')) {
      const newlineIndex = this.buffer.indexOf('\n')
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (!line) {
        continue
      }

      const response = JSON.parse(line) as HubResponse
      if (response.type === 'snapshot') {
        const pendingEntry = [...this.pending.entries()].find(
          ([, entry]) => entry.kind === 'snapshot',
        )

        if (!pendingEntry) {
          continue
        }

        const [cmdId, pending] = pendingEntry
        this.pending.delete(cmdId)
        pending.resolve(response as any)
        continue
      }

      if (response.type !== 'reply' && response.type !== 'error') {
        continue
      }

      const pending = this.pending.get(response.cmdId)
      if (!pending) {
        continue
      }

      this.pending.delete(response.cmdId)
      pending.resolve(response as any)
    }
  }
}

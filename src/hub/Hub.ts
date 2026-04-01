import { LocalSocketServer } from './LocalSocketServer.js'
import { SessionRegistry } from './SessionRegistry.js'

type HubOptions = {
  socketPath: string
}

export class Hub {
  private readonly registry = new SessionRegistry()
  private readonly socketServer: LocalSocketServer
  private running = false

  constructor(private readonly options: HubOptions) {
    this.socketServer = new LocalSocketServer(options.socketPath)
  }

  async start(): Promise<void> {
    await this.socketServer.start()
    this.running = true
  }

  getStatus() {
    return {
      running: this.running,
      sessionCount: this.registry.listSessions().length,
      connectionCount: 0,
      socketPath: this.options.socketPath,
    }
  }

  async stop(): Promise<void> {
    await this.socketServer.stop()
    this.running = false
  }
}

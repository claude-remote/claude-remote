import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import net, { type Server, type Socket } from 'node:net';

type ConnectionHandler = (socket: Socket) => void;

export class LocalSocketServer {
  private server: Server | null = null;

  constructor(
    private readonly socketPath: string,
    private readonly onConnection?: ConnectionHandler,
  ) {}

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) {
      await rm(this.socketPath, { force: true });
    }

    this.server = net.createServer((socket) => {
      this.onConnection?.(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.socketPath, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  address(): string {
    return this.socketPath;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;

    if (existsSync(this.socketPath)) {
      await rm(this.socketPath, { force: true });
    }
  }
}

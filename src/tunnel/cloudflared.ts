import { spawn } from 'node:child_process';

import type { SessionMeta } from '@/shared/types';

export interface CloudflaredTunnel {
  url: string;
  pid?: number;
}

type SpawnFn = typeof spawn;

export class CloudflaredManager {
  private readonly spawnCommand: SpawnFn;

  constructor(spawnCommand: SpawnFn = spawn) {
    this.spawnCommand = spawnCommand;
  }

  async ensureInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = this.spawnCommand('cloudflared', ['--version'], {
        stdio: 'ignore',
      });

      child.once('error', () => resolve(false));
      child.once('exit', (code) => resolve(code === 0));
    });
  }

  async startQuickTunnel(_session?: Pick<SessionMeta, 'id'>): Promise<CloudflaredTunnel> {
    const installed = await this.ensureInstalled();
    if (!installed) {
      throw new Error(
        'cloudflared is not installed. Install it first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
      );
    }

    return new Promise((resolve, reject) => {
      const child = this.spawnCommand('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:3000'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let settled = false;
      const onData = (chunk: Buffer): void => {
        const text = chunk.toString('utf8');
        const matched = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (!matched || settled) {
          return;
        }

        settled = true;
        resolve({
          url: matched[0],
          pid: child.pid,
        });
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      child.once('error', (error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      });

      child.once('exit', (code) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(
          new Error(
            `cloudflared exited before tunnel URL was available (code: ${code ?? 'unknown'}).`,
          ),
        );
      });
    });
  }

  async stop(tunnel: CloudflaredTunnel): Promise<void> {
    if (typeof tunnel.pid !== 'number') {
      return;
    }

    try {
      process.kill(tunnel.pid, 'SIGTERM');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ESRCH') {
        throw error;
      }
    }
  }
}

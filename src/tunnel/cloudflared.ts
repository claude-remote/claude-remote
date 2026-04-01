import type { SessionMeta } from '@/shared/types';

export interface CloudflaredTunnel {
  url: string;
  pid?: number;
}

export class CloudflaredManager {
  async ensureInstalled(): Promise<boolean> {
    // TODO(T25): detect cloudflared availability and report actionable setup errors.
    return false;
  }

  async startQuickTunnel(_session?: Pick<SessionMeta, 'id'>): Promise<CloudflaredTunnel> {
    // TODO(T25): launch quick tunnel, parse URL, and emit bootstrap-token QR code data.
    return {
      url: 'https://example.trycloudflare.com',
    };
  }

  async stop(_tunnel: CloudflaredTunnel): Promise<void> {
    // TODO(T25): terminate managed tunnel processes cleanly.
  }
}

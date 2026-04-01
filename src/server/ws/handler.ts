import type { ClientCommand, HubResponse } from '@/shared/protocol';
import type { SessionSnapshot } from '@/shared/types';

import { Hub } from '@/hub/Hub';

export interface WebSocketConnection {
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

export class WebSocketHandler {
  constructor(readonly hub: Hub) {}

  createHello(hubVersion: string): HubResponse {
    return { type: 'hello', version: 1, hubVersion };
  }

  createSnapshot(snapshot: SessionSnapshot): HubResponse {
    return { type: 'snapshot', snapshot };
  }

  async handleCommand(sessionId: string, command: ClientCommand): Promise<HubResponse> {
    // TODO(T07): validate writer permissions, cmdId correlation, and heartbeat handling.
    return this.hub.handleCommand(sessionId, command);
  }
}

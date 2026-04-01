import { useState } from 'react';

import type { ClientCommand, HubResponse } from '@/shared/protocol';

export interface WebSocketState {
  connected: boolean;
  lastMessage?: HubResponse;
  sendCommand(command: ClientCommand): void;
}

export function useWebSocket(): WebSocketState {
  const [lastMessage] = useState<HubResponse | undefined>(undefined);

  // TODO(T11,T07): implement ticket fetch, reconnect, heartbeat, and snapshot recovery.
  return {
    connected: false,
    lastMessage,
    sendCommand(_command: ClientCommand) {
      return undefined;
    },
  };
}

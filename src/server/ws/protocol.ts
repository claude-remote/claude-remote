import type { ClientCommand, HubResponse } from '@/shared/protocol';

export type ServerClientCommand = ClientCommand;
export type ServerHubResponse = HubResponse;

// TODO(T07,T08): add handshake validation helpers and WS ticket parsing utilities.

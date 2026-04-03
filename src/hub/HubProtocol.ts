import type { Message, PermissionRequest, Task } from '@/shared/types';

// Re-export from shared/protocol so existing importers don't break
export type { ClientCommand, HubEvent, HubResponse } from '@/shared/protocol';
import type { HubResponse } from '@/shared/protocol';

export type HubClientInfo = {
  id: string;
  type: 'tui';
  connectedAt: number;
};

export type Session = {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'idle' | 'archived';
  clients: HubClientInfo[];
  messages: Message[];
  tasks: Task[];
  pendingPermissions?: PermissionRequest[];
  tags?: string[];
};

export type Snapshot = {
  session: Session;
  connectionState: 'connected';
};

export function createNotImplementedChatError(cmdId: string): HubResponse {
  return {
    type: 'error',
    cmdId,
    error: 'chat is not implemented in Local Hub Baseline',
  };
}

export function isHubResponse(value: unknown): value is HubResponse {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const type = (value as { type?: unknown }).type;
  return type === 'hello' || type === 'snapshot' || type === 'event' || type === 'reply' || type === 'error';
}

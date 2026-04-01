export type SessionStatus = 'active' | 'idle'

export type HubClientInfo = {
  id: string
  type: 'tui'
  connectedAt: number
}

export type Session = {
  id: string
  name: string
  cwd: string
  createdAt: number
  updatedAt: number
  status: SessionStatus
  clients: HubClientInfo[]
  messages: []
  tasks: []
}

export type Snapshot = {
  session: Session
  connectionState: 'connected'
}

export type HubEvent =
  | { type: 'session:created'; session: Session }
  | { type: 'session:attached'; sessionId: string; clientId: string }
  | { type: 'session:updated'; session: Session }
  | { type: 'hub:shutdown' }

export type ClientCommand =
  | { cmdId: string; cmd: 'session:create'; cwd: string; name?: string }
  | { cmdId: string; cmd: 'session:list' }
  | { cmdId: string; cmd: 'session:attach'; sessionId: string }
  | { cmdId: string; cmd: 'chat'; text: string }
  | { cmdId: string; cmd: 'hub:status' }

export type HubResponse =
  | { type: 'snapshot'; session: Session }
  | { type: 'event'; event: HubEvent }
  | { type: 'reply'; cmdId: string; data: unknown }
  | { type: 'error'; cmdId: string; error: string; code?: string }

export function createNotImplementedChatError(cmdId: string): HubResponse {
  return {
    type: 'error',
    cmdId,
    code: 'not_implemented',
    error: 'chat is not implemented in Local Hub Baseline',
  }
}

export function isHubResponse(value: unknown): value is HubResponse {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }

  const type = (value as { type?: unknown }).type
  return (
    type === 'snapshot' ||
    type === 'event' ||
    type === 'reply' ||
    type === 'error'
  )
}

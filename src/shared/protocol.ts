import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js'

import type {
  ClientConnection,
  ConfigOptions,
  CostSummary,
  ContextUsage,
  ExportResult,
  HistorySearchResult,
  McpServerInfo,
  PermissionRequest,
  SessionConfig,
  SessionMeta,
  SessionSnapshot,
  SkillInfo,
  Task,
  ToolExecution,
  ToolExecutionStatus,
} from './types.js'

type HubSeqEvent = { seq: number }

export type HubEvent =
  // SDK passthrough
  | ({ type: 'sdk:message'; sessionId: string; payload: SDKMessage } & HubSeqEvent)
  // Session lifecycle / writer management
  | ({ type: 'hub:session:created'; session: SessionMeta } & HubSeqEvent)
  | ({
      type: 'hub:session:statusChanged'
      sessionId: string
      status: SessionMeta['status']
    } & HubSeqEvent)
  | ({ type: 'hub:session:archived'; sessionId: string; reason?: string } & HubSeqEvent)
  | ({
      type: 'hub:writer:changed'
      sessionId: string
      newWriterId: string | null
    } & HubSeqEvent)
  // Permission & context/cost updates
  | ({
      type: 'hub:permission:requested'
      sessionId: string
      request: PermissionRequest
    } & HubSeqEvent)
  | ({
      type: 'hub:permission:resolved'
      sessionId: string
      requestId: string
      status: ToolExecutionStatus | 'approved' | 'denied'
    } & HubSeqEvent)
  | ({ type: 'hub:context:updated'; sessionId: string; usage: ContextUsage } & HubSeqEvent)
  | ({ type: 'hub:cost:updated'; sessionId: string; cost: CostSummary } & HubSeqEvent)
  // MCP / config / skills / tasks / notification
  | ({ type: 'hub:mcp:statusChanged'; server: McpServerInfo } & HubSeqEvent)
  | ({ type: 'hub:config:changed'; sessionId: string; config: SessionConfig } & HubSeqEvent)
  | ({
      type: 'hub:notification'
      sessionId?: string
      message: string
      severity: 'info' | 'warning' | 'error'
    } & HubSeqEvent)
  | ({ type: 'hub:client:joined'; sessionId: string; client: ClientConnection } & HubSeqEvent)
  | ({ type: 'hub:client:left'; sessionId: string; clientId: string } & HubSeqEvent)
  | ({ type: 'hub:task:updated'; sessionId: string; task: Task } & HubSeqEvent)
  | ({ type: 'hub:error'; sessionId?: string; error: string } & HubSeqEvent)
  | ({ type: 'hub:auth:revoked'; reason?: string } & HubSeqEvent)
  | ({ type: 'hub:shutdown'; reason?: string } & HubSeqEvent)
  | ({ type: 'hub:skill:list'; skills: SkillInfo[]; sessionId?: string } & HubSeqEvent)

export type ClientCommand =
  | { cmdId: string; cmd: 'chat'; text: string; images?: string[]; sessionId?: string }
  | { cmdId: string; cmd: 'chat:abort'; sessionId?: string }
  | {
      cmdId: string
      cmd: 'control:respond'
      requestId: string
      response: SDKControlResponse
    }
  | { cmdId: string; cmd: 'session:create'; cwd: string; name?: string }
  | { cmdId: string; cmd: 'session:archive'; sessionId: string }
  | { cmdId: string; cmd: 'session:rename'; sessionId: string; name: string }
  | { cmdId: string; cmd: 'session:setTags'; sessionId: string; tags: string[] }
  | { cmdId: string; cmd: 'session:switchCwd'; sessionId: string; cwd: string }
  | { cmdId: string; cmd: 'config:set'; sessionId: string; patch: Partial<SessionConfig> }
  | { cmdId: string; cmd: 'context:get'; sessionId: string }
  | { cmdId: string; cmd: 'cost:get'; sessionId: string }
  | { cmdId: string; cmd: 'mcp:list' }
  | { cmdId: string; cmd: 'mcp:reconnect'; serverId: string }
  | {
      cmdId: string
      cmd: 'chat:branch'
      sessionId: string
      messageId: string
      name?: string
    }
  | { cmdId: string; cmd: 'chat:export'; sessionId: string; format: ExportResult['format'] }
  | { cmdId: string; cmd: 'chat:compact'; sessionId: string }
  | { cmdId: string; cmd: 'chat:clear'; sessionId: string }
  | { cmdId: string; cmd: 'skill:list'; sessionId: string }
  | { cmdId: string; cmd: 'skill:invoke'; sessionId: string; name: string; args?: string }
  | { cmdId: string; cmd: 'file:list'; sessionId: string; path: string }
  | {
      cmdId: string
      cmd: 'file:read'
      sessionId: string
      path: string
      offset?: number
      limit?: number
    }
  | {
      cmdId: string
      cmd: 'history:search'
      query: string
      scope?: 'session' | 'all'
      sessionId?: string
      limit?: number
    }
  | { cmdId: string; cmd: 'writer:takeOver'; sessionId: string }

export interface HubResponse {
  cmdId: string
  ok: boolean
  data?: unknown
  error?: string
}

export interface HubMessageHello {
  type: 'hello'
  version: number
  hubVersion: string
}

export interface HubMessageSnapshot {
  type: 'snapshot'
  snapshot: SessionSnapshot
}

export interface HubMessageEvent {
  type: 'event'
  event: HubEvent
}

export interface HubMessageReply {
  type: 'reply'
  cmdId: string
  data: unknown
}

export interface HubMessageError {
  type: 'error'
  cmdId: string
  error: string
}

export type HubResponseEnvelope =
  | HubMessageHello
  | HubMessageSnapshot
  | HubMessageEvent
  | HubMessageReply
  | HubMessageError
  | ({ type: 'reply'; response: HubResponse } & HubSeqEvent)
  | ({ type: 'error'; response: HubResponse } & HubSeqEvent)

export {
  ConfigOptions,
  CostSummary,
  ContextUsage,
  ExportResult,
  HistorySearchResult,
  McpServerInfo,
  PermissionRequest,
  SessionConfig,
  SessionMeta,
  SessionSnapshot,
  SkillInfo,
  Task,
  ToolExecution,
}

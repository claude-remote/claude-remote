import type {
  ClientConnection,
  ConfigOptions,
  ContextUsage,
  CostSummary,
  ExportResult,
  HistorySearchResult,
  McpServerInfo,
  PermissionRequest,
  SessionConfig,
  SessionMeta,
  SessionSnapshot,
  SessionStatus,
  SkillInfo,
} from '@/shared/types';

export interface SDKMessage {
  type: string;
  [key: string]: unknown;
}

export interface SDKControlRequest {
  type: 'control_request';
  requestId: string;
  request: Record<string, unknown>;
}

export interface SDKControlCancelRequest {
  type: 'control_cancel';
  requestId: string;
}

export interface SDKControlResponse {
  type: 'control_response';
  requestId: string;
  response: Record<string, unknown>;
}

export type HubEvent =
  | { type: 'sdk:message'; sessionId: string; seq: number; payload: SDKMessage }
  | { type: 'sdk:control'; sessionId: string; seq: number; payload: SDKControlRequest }
  | { type: 'sdk:control:cancel'; sessionId: string; seq: number; payload: SDKControlCancelRequest }
  | { type: 'sdk:control:response'; sessionId: string; seq: number; payload: SDKControlResponse }
  | { type: 'hub:session:created'; seq: number; session: SessionMeta }
  | { type: 'hub:session:cwdChanged'; seq: number; sessionId: string; cwd: string }
  | {
      type: 'hub:session:statusChanged';
      seq: number;
      sessionId: string;
      status: SessionStatus;
    }
  | { type: 'hub:client:joined'; seq: number; sessionId: string; client: ClientConnection }
  | { type: 'hub:client:left'; seq: number; sessionId: string; clientId: string }
  | { type: 'hub:writer:changed'; seq: number; sessionId: string; newWriterId: string | null }
  | {
      type: 'hub:takeOver:request';
      seq: number;
      sessionId: string;
      requesterId: string;
      requesterType: ClientConnection['type'];
    }
  | { type: 'hub:config:changed'; seq: number; sessionId: string; config: SessionConfig }
  | { type: 'hub:context:updated'; seq: number; sessionId: string; usage: ContextUsage }
  | { type: 'hub:cost:updated'; seq: number; sessionId: string; cost: CostSummary }
  | { type: 'hub:chat:cleared'; seq: number; sessionId: string }
  | {
      type: 'hub:chat:branched';
      seq: number;
      sessionId: string;
      newSession: SessionMeta;
      fromMessageId: string;
    }
  | { type: 'hub:chat:compacted'; seq: number; sessionId: string }
  | { type: 'hub:skills:updated'; seq: number; sessionId: string; skills: SkillInfo[] }
  | { type: 'hub:mcp:statusChanged'; seq: number; server: McpServerInfo }
  | {
      type: 'hub:rateLimited';
      seq: number;
      sessionId: string;
      retryAfterMs: number;
      scope: 'global' | 'session';
    }
  | { type: 'hub:auth:revoked' }
  | { type: 'hub:shutdown' };

export type ClientCommand = { cmdId: string } & (
  | { cmd: 'chat'; text: string; images?: string[] }
  | { cmd: 'chat:abort' }
  | { cmd: 'control:respond'; requestId: string; response: SDKControlResponse }
  | { cmd: 'session:create'; cwd: string; name?: string }
  | { cmd: 'session:list' }
  | { cmd: 'session:switch'; sessionId: string }
  | { cmd: 'session:rename'; name: string }
  | { cmd: 'session:attach'; sessionId: string }
  | { cmd: 'session:archive'; sessionId: string }
  | { cmd: 'session:takeOver' }
  | { cmd: 'session:takeOver:approve' }
  | { cmd: 'session:takeOver:reject' }
  | { cmd: 'session:releaseWriter' }
  | { cmd: 'cwd:change'; path: string }
  | { cmd: 'cwd:browse'; path: string }
  | { cmd: 'cwd:favorites' }
  | { cmd: 'cwd:addFavorite'; path: string; label?: string }
  | { cmd: 'skill:list' }
  | { cmd: 'skill:invoke'; name: string; args?: string }
  | { cmd: 'config:get' }
  | { cmd: 'config:set'; patch: Partial<SessionConfig> }
  | { cmd: 'context:usage' }
  | { cmd: 'cost:get' }
  | { cmd: 'mcp:list' }
  | { cmd: 'mcp:toggle'; serverId: string; enabled: boolean }
  | { cmd: 'mcp:reconnect'; serverId: string }
  | { cmd: 'chat:branch'; messageId: string; name?: string }
  | { cmd: 'chat:compact' }
  | { cmd: 'chat:export'; format: 'markdown' | 'json' }
  | { cmd: 'chat:clear' }
  | { cmd: 'file:read'; path: string; offset?: number; limit?: number }
  | { cmd: 'file:list'; path: string; pattern?: string }
  | { cmd: 'file:search'; pattern: string; path?: string }
  | { cmd: 'history:search'; query: string; scope: 'session' | 'all'; limit?: number }
  | { cmd: 'hub:status' }
);

export type HubReplyData =
  | SessionSnapshot
  | SessionMeta
  | SessionMeta[]
  | PermissionRequest
  | SkillInfo[]
  | SessionConfig
  | { config: SessionConfig; options: ConfigOptions }
  | ContextUsage
  | CostSummary
  | McpServerInfo[]
  | ExportResult
  | HistorySearchResult[]
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>;

export type HubResponse =
  | { type: 'hello'; version: number; hubVersion: string }
  | { type: 'snapshot'; snapshot: SessionSnapshot }
  | { type: 'event'; event: HubEvent }
  | { type: 'reply'; cmdId: string; data: HubReplyData }
  | { type: 'error'; cmdId?: string; error: string };

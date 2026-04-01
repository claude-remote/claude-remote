export type SessionStatus = 'active' | 'idle' | 'interrupted' | 'archived';
export type ClientType = 'tui' | 'web';
export type WriterStatus = 'active' | 'standby';
export type SessionPermissionMode = 'ask' | 'approve' | 'bypass';
export type EffortLevel = 'low' | 'medium' | 'high';

export interface StreamDelta {
  messageId: string;
  contentBlockIndex: number;
  type: 'text_delta' | 'input_json_delta';
  text?: string;
  partialJson?: string;
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string | Record<string, unknown>;
  isError?: boolean;
}

export interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    mediaType: string;
    data: string;
  };
}

export type MessageContentBlock =
  | TextContentBlock
  | (ToolUseBlock & { type: 'tool_use' })
  | ToolResultContentBlock
  | ImageContentBlock;

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: MessageContentBlock[];
  createdAt: number;
  updatedAt: number;
  model?: string;
  stopReason?: string;
}

export interface Task {
  id: string;
  sessionId: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'killed';
  activeForm?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdAt: number;
}

export interface ClientConnection {
  id: string;
  type: ClientType;
  writerStatus: WriterStatus;
  connectedAt: number;
  userAgent?: string;
}

export interface SessionMeta {
  id: string;
  name: string;
  cwd: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  clientCount: number;
  hasActiveWriter: boolean;
  tags?: string[];
}

export interface SkillInfo {
  name: string;
  description: string;
  aliases?: string[];
  userInvocable: boolean;
  arguments?: string[];
  source: 'bundled' | 'plugin' | 'project' | 'user';
}

export interface SessionConfig {
  model: string;
  effortLevel: EffortLevel;
  permissionMode: SessionPermissionMode;
  maxThinkingTokens?: number;
}

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  percentage: number;
  breakdown: Array<{
    label: string;
    tokens: number;
  }>;
}

export interface CostSummary {
  sessionCost: number;
  formattedCost: string;
  inputTokens: number;
  outputTokens: number;
  apiCalls: number;
  sessionDuration: number;
}

export interface ConfigOptions {
  availableModels: Array<{
    id: string;
    name: string;
    supportsImages: boolean;
  }>;
  effortLevels: EffortLevel[];
  permissionModes: SessionPermissionMode[];
}

export interface ExportResult {
  content: string;
  format: 'markdown' | 'json';
  filename: string;
}

export interface HistorySearchResult {
  sessionId: string;
  sessionName: string;
  messageId: string;
  role: 'user' | 'assistant';
  snippet: string;
  timestamp: number;
}

export interface McpServerInfo {
  id: string;
  name: string;
  type: 'stdio' | 'sse' | 'http';
  status: 'connected' | 'disconnected' | 'error';
  enabled: boolean;
  toolCount: number;
  error?: string;
}

export interface SessionSnapshot {
  meta: SessionMeta;
  recentMessages: Message[];
  activeTasks: Task[];
  pendingPermissions: PermissionRequest[];
  clients: ClientConnection[];
  availableSkills: SkillInfo[];
  config: SessionConfig;
  configOptions: ConfigOptions;
  contextUsage: ContextUsage;
  costSummary: CostSummary;
  mcpServers: McpServerInfo[];
  myWriterStatus: WriterStatus;
  lastSeq: number;
}

export interface Session extends SessionMeta {
  messages: Message[];
  tasks: Task[];
  pendingPermissions: PermissionRequest[];
  clients: ClientConnection[];
}

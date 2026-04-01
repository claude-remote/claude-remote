export type SessionStatus = 'active' | 'idle' | 'interrupted' | 'archived';
export type ClientRole = 'writer' | 'standby';
export type PermissionMode = 'ask' | 'approve' | 'bypass';
export type ToolExecutionStatus = 'running' | 'completed' | 'failed' | 'interrupted' | 'crashed';

/**
 * 消息流增量片段。
 */
export interface StreamDelta {
  messageId: string;
  contentBlockIndex: number;
  type: 'text_delta' | 'input_json_delta';
  text?: string;
  partialJson?: string;
}

/**
 * 工具调用块。
 */
export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * 纯文本内容块。
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/**
 * 工具调用返回内容块。
 */
export interface ToolResultContentBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string | Record<string, unknown>;
  isError?: boolean;
}

/**
 * 图片内容块。
 */
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

/**
 * Claude 消息对象。
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: MessageContentBlock[];
  created_at: number;
  updated_at: number;
}

/**
 * 任务定义。
 */
export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'crashed' | 'killed';
  assignee: string;
  session_id: string;
  created_at: number;
  updated_at: number;
}

/**
 * 客户端连接信息。
 */
export interface ClientConnection {
  id: string;
  role: ClientRole;
  connected_at: number;
}

/**
 * 工具执行记录。
 */
export interface ToolExecution {
  id: string;
  name: string;
  status: ToolExecutionStatus;
}

/**
 * 权限请求。
 */
export interface PermissionRequest {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  requestId: string;
  created_at: number;
}

/**
 * 上下文窗口使用情况。
 */
export interface ContextUsage {
  used_tokens: number;
  max_tokens: number;
  percentage: number;
}

/**
 * 费用摘要。
 */
export interface CostSummary {
  session_cost: number;
  total_cost: number;
  currency: string;
}

/**
 * MCP 服务信息。
 */
export interface McpServerInfo {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  tools_count: number;
  enabled: boolean;
}

/**
 * Skill 信息。
 */
export interface SkillInfo {
  name: string;
  description: string;
  args_hint?: string[];
}

/**
 * 对话导出结果。
 */
export interface ExportResult {
  format: 'markdown' | 'json';
  content: string;
  filename: string;
}

/**
 * 历史搜索结果。
 */
export interface HistorySearchResult {
  message_id: string;
  session_id: string;
  snippet: string;
  timestamp: number;
}

/**
 * 配置项定义。
 */
export interface ConfigOptions {
  available_models: {
    id: string;
    name: string;
    supports_images: boolean;
  }[];
}

/**
 * 会话配置。
 */
export interface SessionConfig {
  model: string;
  permissions_mode: PermissionMode;
  system_prompt: string;
}

/**
 * 会话元信息（列表视图）。
 */
export interface SessionMeta {
  id: string;
  name: string;
  status: SessionStatus;
  cwd: string;
  tags: string[];
  config: SessionConfig;
  created_at: number;
  updated_at: number;
  idle_timeout_ms: number;
}

/**
 * 会话快照（WS 重连恢复）。
 */
export interface SessionSnapshot {
  meta: SessionMeta;
  messages: Message[];
  tasks: Task[];
  pendingPermissions: PermissionRequest[];
  clients: ClientConnection[];
  availableSkills: SkillInfo[];
  config: SessionConfig;
  configOptions: ConfigOptions;
  contextUsage: ContextUsage;
  costSummary: CostSummary;
  mcpServers: McpServerInfo[];
  myWriterStatus: ClientRole;
  lastSeq: number;
}

/**
 * 完整会话对象。
 */
export interface Session extends SessionMeta {
  messages: Message[];
  tasks: Task[];
  pendingPermissions: PermissionRequest[];
  clients: ClientConnection[];
}

// ---- compatibility aliases ----
type EffortLevel = 'low' | 'medium' | 'high';
type LegacyWriterStatus = 'active' | 'standby';

type LegacyClientType = 'tui' | 'web';

type LegacyTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'killed';

export interface LegacyMessage extends Message {
  createdAt: number;
  updatedAt: number;
}

export interface LegacyTask extends Omit<Task, 'status' | 'assignee'> {
  subject: string;
  activeForm?: string;
  sessionId: string;
  status: LegacyTaskStatus;
}

export interface LegacyPermissionRequest extends PermissionRequest {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdAt: number;
}

export interface LegacyClientConnection extends ClientConnection {
  type: LegacyClientType;
  writerStatus: LegacyWriterStatus;
  connectedAt: number;
}

export type ClientType = LegacyClientType;
export type WriterStatus = LegacyWriterStatus;

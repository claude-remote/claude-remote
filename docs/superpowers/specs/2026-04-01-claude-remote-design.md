# Claude Remote - Design Spec

> 将 Claude Code CLI 升级为可远程控制的 AI 开发服务，支持手机 Web 端全功能操作。

## 1. 概述

### 1.1 目标

将现有 Claude Code CLI（claude-code-haha）改造为 **claude-remote**，一个有状态的 AI 开发服务，支持：

- 手机浏览器远程控制，功能与终端完全对齐
- 多 session 管理，持久化存储
- 工作目录切换（收藏列表 + 文件浏览器）
- 多客户端实时同步（TUI + Web 共享 session）
- Cloudflare Tunnel 公网访问
- Token 认证

### 1.2 命名规范

| 项目 | 命名 |
|---|---|
| 仓库名 | `claude-remote` |
| CLI 命令 | `claude-remote` |
| Hub 启动 | `claude-remote serve` |
| TUI 连接 | `claude-remote attach` |
| 配置目录 | `~/.claude-remote/` |
| SQLite | `~/.claude-remote/hub.db` |
| Token 文件 | `~/.claude-remote/hub.token` |
| npm package | `claude-remote` |

### 1.3 技术栈

| 层级 | 技术 |
|---|---|
| 运行时 | Bun |
| 语言 | TypeScript |
| 服务端 | Hono.js（HTTP + WebSocket） |
| 前端 | React 19 + Tailwind CSS + Zustand |
| TUI | React + Ink（现有） |
| 数据库 | SQLite（持久化） |
| 隧道 | Cloudflare Tunnel（cloudflared） |
| 构建 | Bun 打包，Hub 进程 serve 静态文件 |

## 2. 架构

### 2.1 Session Hub 架构

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  手机浏览器   │     │  终端 TUI    │     │  另一个终端   │
│  (Web SPA)  │     │  (Ink)      │     │  (Ink)       │
└──────┬──────┘     └──────┬──────┘     └──────┬───────┘
       │ WebSocket         │ Unix Socket       │
       ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────┐
│                   Session Hub（常驻进程）               │
│                                                      │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │
│  │ Session A   │  │ Session B   │  │ Session C     │  │
│  │ cwd: /proj1 │  │ cwd: /proj2 │  │ cwd: /proj3   │  │
│  │ messages[]  │  │ messages[]  │  │ messages[]    │  │
│  │ tasks[]     │  │ tasks[]     │  │ tasks[]       │  │
│  └────────────┘  └────────────┘  └───────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ Tool Engine（复用现有 47 个 tool）              │    │
│  ├──────────────────────────────────────────────┤    │
│  │ Claude API Client                            │    │
│  ├──────────────────────────────────────────────┤    │
│  │ Session Store（SQLite 持久化）                 │    │
│  ├──────────────────────────────────────────────┤    │
│  │ Event Bus（实时状态广播）                      │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Hono HTTP/WS Server (:3456)                        │
└──────────────────────────────────────────────────────┘
       │
  Cloudflare Tunnel
       │
    公网访问
```

### 2.2 核心设计原则

- **Hub 是引擎**：所有 Tool 执行、Claude API 调用、状态管理都在 Hub 进程中
- **客户端是视图**：TUI 和 Web 都是纯展示层，通过 WebSocket 收发事件
- **Session 独立**：每个 session 有独立的 cwd、消息历史、任务列表
- **事件驱动**：所有状态变更通过 Event Bus 广播，客户端实时同步

### 2.3 与现有远程架构的关系

> **架构决策**：claude-remote **复用并扩展**现有 `src/remote/` 和 `src/cli/transports/` 的远程控制路径，不是替换它。Hub 的 WebSocket 协议直接透传 SDK 原生消息格式（SDKMessage、SDKControlRequest/Response/Cancel），Web 前端复用现有的 `sdkMessageAdapter.ts` 做 UI 渲染转换。这确保了上游 SDK 新增消息类型时 Hub 层无需修改。

代码库中已存在远程控制相关模块，处理策略如下：

| 现有模块 | 作用 | 策略 |
|---|---|---|
| `src/remote/RemoteSessionManager.ts` | 远程 session 管理、WS 通信、权限桥接 | **复用并扩展**：作为 Hub SessionManager 基础 |
| `src/remote/SessionsWebSocket.ts` | WS 客户端，含重连、ping/pong、proxy | **复用**：TUI 客户端直接使用 |
| `src/server/directConnectManager.ts` | DirectConnect session 管理 | **替换**：被 Hub SessionManager 取代 |
| `src/server/types.ts` | `ServerConfig`、`SessionState` 等类型 | **扩展**：保留 `maxSessions`、`idleTimeoutMs`，补充新字段 |
| `src/utils/cwd.ts` | `AsyncLocalStorage` 并发 cwd 隔离 | **直接复用**：`runWithCwdOverride` 解决多 session cwd 隔离 |
| `src/state/AppState` | 含 `remoteSessionUrl`、bridge session 字段 | **每 session 独立实例** |

### 2.4 Tool 并发执行与隔离

多 session 同时执行 tool 是核心难题，设计如下：

**CWD 隔离**：每个 session 的 tool 执行包裹在 `runWithCwdOverride(session.cwd, fn)` 中，利用现有的 `AsyncLocalStorage` 机制，`pwd()` 自动返回当前 session 的目录，无需全局锁。

**AppState 隔离**：每个 session 持有独立的 `AppState` 实例，tool 执行时通过 `ToolUseContext` 绑定到对应 session 的 state。

**并发控制**：
- 同一 session 内：tool 串行执行（与当前 TUI 行为一致，Claude API 的 tool_use 本身是顺序的）
- 跨 session：tool 并行执行，但受全局并发上限限制（默认 5）
- `BashTool` 产生的子进程绑定到 session，session 归档时 kill 所有关联子进程

**资源隔离**：
- 每个 session 的 `BashTool` 子进程通过 process group 管理
- 文件操作通过 `realpath` + 白名单校验路径合法性（复用文件浏览器的安全机制）

## 3. Session Hub 核心

### 3.1 进程模型

新增入口 `src/entrypoints/serve.ts`：

```bash
claude-remote serve [--port 3456] [--tunnel]
```

- 常驻后台运行，不渲染 TUI
- 启动时生成随机 token 并打印到终端
- 管理所有 session 的生命周期

现有 TUI 模式改为 Hub 客户端：

```bash
claude-remote attach       # 显式连接到已运行的 Hub
                           # 有 → 读 token → 连接 WebSocket
                           # 无 → 自动 fork 子进程启动 Hub → 等待就绪 → 连接
```

> **注意**：`attach` 会在后台 fork Hub 进程（如果尚未运行）。首次使用时终端会提示 Hub 已启动。

**TUI 降级模式：**

当 Hub 不可用（崩溃、网络异常等）时，TUI 可回退到独立运行模式（直接调用 Claude API 和 Tool），保证本地可用性不受 Hub 状态影响。

> **独立模式与 Hub 的互斥**：TUI 进入独立模式后，其对话状态独立于 Hub。如果 Hub 随后恢复，TUI 不会自动切回 Hub 模式，也不会将独立模式中的对话同步到 Hub。用户需手动退出 TUI 并重新 `claude-remote attach` 连接 Hub。这是有意为之——避免两个引擎（Hub + 独立 TUI）同时操作同一工作目录导致冲突。

**本地通信：**

TUI 与 Hub 之间优先使用 Unix Socket（`~/.claude-remote/hub.sock`）而非 TCP WebSocket，减少本地通信开销，避免不必要的网络依赖。

### 3.2 Session 数据模型

```typescript
// Session 状态机
type SessionStatus = 'active' | 'idle' | 'interrupted' | 'archived'

// 状态转换规则：
// active  → idle         : 所有客户端断开连接后，经过 idleTimeoutMs（默认 30 分钟，见 config.toml [limits] 节）
// active  → archived     : 用户手动归档
// idle    → active       : 任意客户端重新连接
// idle    → archived     : 用户手动归档，或达到 max_sessions 上限时自动归档最久 idle
// interrupted → active   : 用户选择"继续对话"
// interrupted → archived : 用户选择"归档"
// archived → (终态)      : 不可恢复为其他状态

interface Session {
  id: string                    // uuid
  name: string                  // 用户可命名，如 "screenpipe 重构"
  cwd: string                   // 工作目录
  createdAt: number
  updatedAt: number
  status: SessionStatus
  messages: Message[]           // 对话历史（复用现有 Message 类型）
  tasks: Task[]                 // 任务列表
  pendingPermissions: PermissionRequest[]  // 等待审批的权限请求
  clients: ClientConnection[]   // 当前连接的客户端列表
}

interface ClientConnection {
  id: string
  type: 'tui' | 'web'
  writerStatus: 'active' | 'standby'  // 每 session 最多一个 active writer
  connectedAt: number
  userAgent?: string
}
```

### 3.3 持久化层

SQLite 数据库位于 `~/.claude-remote/hub.db`：

**表结构：**

- `sessions` — session 元数据（id, name, cwd, status, created_at, updated_at）
- `messages` — 对话消息（id, session_id, role, content, created_at）
- `tasks` — 任务（id, session_id, subject, description, status, created_at）
- `favorites` — 收藏目录（id, path, label, last_used）
- `tool_executions` — 工具执行记录（id, session_id, tool_name, status, started_at, finished_at, error）
  - `status` 枚举：`running` | `completed` | `failed` | `interrupted`（Hub 优雅关闭时未完成）| `crashed`（Hub 非正常退出后恢复时标记）

**策略：**

- SQLite 启用 **WAL 模式**（`PRAGMA journal_mode=WAL`），支持并发读写，避免流式消息高频写入时阻塞读操作
- `message:streaming` 事件不逐 delta 写入 SQLite，仅在 `message:done` 时写入完整消息，减少写入压力
- 内存中维护活跃 session 的状态
- SQLite 做异步落盘（消息完成时写入）
- Hub 启动时从 SQLite 恢复未归档的 session
- Hub 启动时检查 `tool_executions` 中状态为 `running` 的记录，标记为 `crashed`（崩溃恢复）

**资源限制：**

| 资源 | 默认上限 |
|---|---|
| 活跃 session 数 | 10 |
| 单 session 内存中消息数 | 1000（更早的消息从 SQLite 按需加载） |
| 并发工具执行数 | 5（跨所有 session） |
| 单 session WebSocket 连接数 | 10 |

**达到上限时的行为：**

- 活跃 session 数达上限 → 自动归档最久未活跃的 idle session；如全部 active 则拒绝创建并返回错误
- 内存消息数达上限 → 最早的消息从内存中驱逐（仍可从 SQLite 按需加载）
- 并发工具执行数达上限 → 新的工具调用排队等待，超过 30 秒未开始则返回超时错误
- WebSocket 连接数达上限 → 拒绝新连接，返回 HTTP 429

**SQLite 迁移策略：**

- 数据库版本号记录在 `meta` 表中
- Hub 启动时检查版本号，如需升级则自动执行迁移脚本（`store/migrations/*.sql`）
- 迁移在事务中执行，失败则回滚并阻止 Hub 启动
- 重大版本升级前自动备份数据库文件

## 4. Event Bus

### 4.1 事件模型：SDK 原生透传 + Hub 扩展

> **设计决策**：现有远程协议（`src/remote/`）已经承载了丰富的 SDK 消息族（SDKMessage、SDKControlRequest/Response/Cancel），包含 20+ 控制子类型（MCP 管理、中断、elicitation、hook_callback 等）。Hub 的事件模型不应重新发明一个缩减版协议，而是**透传 SDK 原生消息**，仅在外层包装 Hub 路由信息。

```typescript
// === SDK 原生消息透传 ===
// Hub 将 SDK 消息原样包装转发，不做字段裁剪
// 客户端按照 SDKMessage/SDKControl* 已有类型处理

type HubEvent =
  // SDK 消息透传（复用 src/remote/ 已有类型）
  | { type: 'sdk:message';         sessionId: string; seq: number; payload: SDKMessage }
  | { type: 'sdk:control';         sessionId: string; seq: number; payload: SDKControlRequest }
  | { type: 'sdk:control:cancel';  sessionId: string; seq: number; payload: SDKControlCancelRequest }
  | { type: 'sdk:control:response'; sessionId: string; seq: number; payload: SDKControlResponse }
  // Hub 管理事件（SDK 层没有的）
  // 注意：所有 hub:* 事件也携带 seq（与 SDK 事件共享同一序列），客户端统一按 seq 排序处理
  | { type: 'hub:session:created';    seq: number; session: SessionMeta }
  | { type: 'hub:session:cwdChanged'; seq: number; sessionId: string; cwd: string }
  | { type: 'hub:session:statusChanged'; seq: number; sessionId: string; status: SessionStatus }
  | { type: 'hub:client:joined';     seq: number; sessionId: string; client: ClientConnection }
  | { type: 'hub:client:left';       seq: number; sessionId: string; clientId: string }
  | { type: 'hub:writer:changed';    seq: number; sessionId: string; newWriterId: string | null }
  | { type: 'hub:takeOver:request';  seq: number; sessionId: string; requesterId: string; requesterType: 'tui' | 'web' }
  | { type: 'hub:config:changed';    seq: number; sessionId: string; config: SessionConfig }
  | { type: 'hub:context:updated';   seq: number; sessionId: string; usage: ContextUsage }
  | { type: 'hub:cost:updated';      seq: number; sessionId: string; cost: CostSummary }
  | { type: 'hub:chat:cleared';      seq: number; sessionId: string }  // 对话已清空，客户端需重置消息列表
  | { type: 'hub:chat:branched';     seq: number; sessionId: string; newSession: SessionMeta; fromMessageId: string }
  | { type: 'hub:chat:compacted';    seq: number; sessionId: string }  // 上下文已压缩，客户端需拉取新 snapshot
  | { type: 'hub:skills:updated';    seq: number; sessionId: string; skills: SkillInfo[] }
  // Hub 全局事件（不绑定 session，广播给所有连接）
  | { type: 'hub:mcp:statusChanged'; seq: number; server: McpServerInfo }  // MCP 是 Hub 全局资源
  | { type: 'hub:auth:revoked' }     // 无 seq，收到后立即断连
  | { type: 'hub:shutdown' }         // 无 seq，收到后立即断连
```

**透传原则：**

- Hub 不维护 SDK 消息类型的硬编码白名单，上游新增消息类型时自动透传，无需修改 Hub 协议
- Web 前端通过 `sdkMessageAdapter`（复用现有 `src/remote/sdkMessageAdapter.ts`）将 SDK 消息转换为 UI 渲染模型
- 未识别的 SDK 消息类型在 UI 层静默忽略（与现有 TUI 行为一致）

**Hub 对 SDK 消息的处理边界：**

Hub 在透传的同时，对部分消息类型有额外处理（不改变消息内容，只做副作用）：

| 处理类型 | 消息类型 | Hub 的额外动作 |
|---|---|---|
| 持久化 | `assistant`（完整消息）、`result` | 写入 SQLite `messages` 表 |
| 持久化 | `tool_result` | 写入 SQLite `messages` 表 + 更新 `tool_executions` 状态 |
| 不持久化 | streaming delta、`tool_progress`、`status` | 仅广播，不写 SQLite |
| 不识别 | 未知类型 | 原样广播，不做任何额外处理 |

**客户端写入信任边界：**

> 客户端**不能直接发送任意 SDKMessage**。Hub-to-client 方向透传所有 SDK 消息类型，但 client-to-Hub 方向严格限制为三种操作：

| 客户端命令 | Hub 内部行为 |
|---|---|
| `chat` | Hub 构造 `SDKUserMessage`，注入对话流 |
| `chat:abort` | Hub 发送 `interrupt` 控制命令给 Claude API |
| `control:respond` | Hub 校验 `requestId` 对应 pending 的控制请求后转发 `SDKControlResponse`；`requestId` 不存在或已过期则返回错误 |

客户端永远不会接触到 `SDKMessage`、`SDKControlRequest` 等服务端消息类型的构造。这与现有远程实现的信任模型一致（参考 `directConnectManager.ts` 和 `RemoteSessionManager.ts`）。

### 4.2 共享类型定义

```typescript
// 流式文本增量，对应 Claude API 的 content_block_delta 事件
interface StreamDelta {
  messageId: string
  contentBlockIndex: number      // 对应 Message.content 数组的索引
  type: 'text_delta' | 'input_json_delta'
  text?: string                  // type=text_delta 时
  partialJson?: string           // type=input_json_delta 时（tool_use 参数流式）
}

// 工具调用块，对应 Claude API 的 tool_use content block
interface ToolUseBlock {
  id: string                     // tool use id
  name: string                   // tool 名称，如 "BashTool"
  input: Record<string, unknown> // tool 参数
}

// 任务类型
interface Task {
  id: string
  sessionId: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'killed'
  activeForm?: string            // 进行中时的描述
  createdAt: number
  updatedAt: number
}

// 权限请求（对应 SDK 的 can_use_tool 控制请求）
interface PermissionRequest {
  id: string                     // 请求 ID，用于 control:respond 关联
  sessionId: string
  toolName: string               // 请求执行的工具名
  toolInput: Record<string, unknown>  // 工具参数
  createdAt: number
}

// Session 元数据（不含 messages/tasks/clients，用于列表展示和 HubEvent）
interface SessionMeta {
  id: string
  name: string
  cwd: string
  status: 'active' | 'idle' | 'interrupted' | 'archived'
  createdAt: number
  updatedAt: number
  clientCount: number            // 当前连接数
  hasActiveWriter: boolean
}

// Session 快照（连接/重连时发送，包含恢复客户端状态所需的全部数据）
// 注意：不包含完整的 Session 对象，避免 messages[] 等大字段的冗余
interface SessionSnapshot {
  meta: SessionMeta
  recentMessages: Message[]      // 最近 N 条完整消息（默认 50）
  activeTasks: Task[]
  pendingPermissions: PermissionRequest[]
  clients: ClientConnection[]
  availableSkills: SkillInfo[]     // 当前 cwd 下可用的 skill 列表
  config: SessionConfig            // 当前 session 配置
  contextUsage: ContextUsage       // 上下文窗口使用情况
  costSummary: CostSummary         // 费用摘要
  mcpServers: McpServerInfo[]      // MCP 服务状态列表（Hub 全局，非 session 级，所有 session 共享）
  myWriterStatus: 'active' | 'standby'  // 当前连接的 writer 状态
  lastSeq: number                // 最新事件序列号，客户端从此处接收增量
}

// Skill 摘要信息（用于列表展示和自动补全，不含完整 prompt 内容）
interface SkillInfo {
  name: string                   // skill 名称，如 "commit"、"review-pr"
  description: string            // 一行描述
  aliases?: string[]             // 别名列表
  userInvocable: boolean         // 是否可由用户直接调用
  arguments?: string[]           // 期望的参数列表
  source: 'bundled' | 'plugin' | 'project' | 'user'  // 来源
}

// Session 配置（可由 active writer 通过 config:set 修改）
interface SessionConfig {
  model: string                  // 当前模型 ID
  effortLevel: 'low' | 'medium' | 'high'  // 思考强度
  permissionMode: 'ask' | 'approve' | 'bypass'  // 权限模式
  maxThinkingTokens?: number
}

// 上下文窗口使用情况
interface ContextUsage {
  usedTokens: number
  maxTokens: number
  percentage: number             // 0-100
  breakdown: Array<{             // 各部分占比
    label: string                // 如 "system prompt"、"conversation"、"tool results"
    tokens: number
  }>
}

// 费用摘要
interface CostSummary {
  sessionCost: number            // 美元，当前 session 累计
  formattedCost: string          // 格式化后的费用字符串
  inputTokens: number
  outputTokens: number
  apiCalls: number
  sessionDuration: number        // 秒
}

// 配置选项（可选值列表，用于 UI 下拉展示）
interface ConfigOptions {
  availableModels: Array<{ id: string; name: string; supportsImages: boolean }>
  effortLevels: Array<'low' | 'medium' | 'high'>
  permissionModes: Array<'ask' | 'approve' | 'bypass'>
}

// 对话导出结果（chat:export 的 reply.data）
interface ExportResult {
  content: string                // 导出的文本内容
  format: 'markdown' | 'json'
  filename: string               // 建议的文件名，如 "session-name-2026-04-01.md"
}

// 历史搜索结果（history:search 的 reply.data）
interface HistorySearchResult {
  sessionId: string
  sessionName: string
  messageId: string
  role: 'user' | 'assistant'
  snippet: string                // 匹配片段（高亮关键词用 <mark> 标签）
  timestamp: number
}

// MCP 服务信息
interface McpServerInfo {
  id: string
  name: string
  type: 'stdio' | 'sse' | 'http'
  status: 'connected' | 'disconnected' | 'error'
  enabled: boolean
  toolCount: number              // 该服务提供的 tool 数量
  error?: string                 // status=error 时的错误信息
}

// 消息序列化：messages 表的 content 字段存储为 JSON text
// 完整保留 Claude API 的多部分 content 结构（text、tool_use、tool_result、image 等）
// 示例：[{"type":"text","text":"..."},{"type":"tool_use","id":"...","name":"BashTool","input":{...}}]
```

### 4.3 广播机制

- Hub 维护一个 `Map<sessionId, Set<WebSocket>>` 映射
- 事件产生时，广播给该 session 下所有已连接的 WebSocket
- 同时异步写入 SQLite（消息和任务事件）

**顺序保证：**

- 每个事件携带单调递增的 `seq` 序列号（每 session 独立计数）
- 客户端按 `seq` 排序处理事件，发现跳号时断开重连获取新 snapshot（不支持逐条重发）
- **需持久化的事件**（完整消息、tool_result）：先写 SQLite，再广播，确保崩溃恢复不丢
- **不持久化的事件**（streaming delta、tool_progress、status）：直接广播，不等 SQLite。崩溃时丢失这些中间状态是可接受的（恢复后以最终持久化的完整消息为准）

**慢客户端背压：**

> SDK streaming delta 是增量的（每个 chunk 只包含新增内容），不是全量替换，因此**不能通过合并/丢弃中间 delta 来降压**——丢失任何一个 chunk 都会导致客户端文本截断。

- 每个 WebSocket 连接维护发送队列，监控队列深度
- 队列深度超过 1000 条时：断开该连接，客户端重连后通过 snapshot 恢复完整状态（snapshot 包含已完成消息的全文，streaming 中的消息在重连后会从当前位置继续推送）
- 仅对具有「最新值覆盖」语义的 Hub 管理事件（如 `hub:client:joined/left`）允许合并去重

## 5. WebSocket 协议

### 5.1 连接

WebSocket 连接使用一次性 ticket 机制，避免长期凭证出现在 URL 或头中：

```typescript
// Step 1: 通过 httpOnly cookie 认证的 HTTP 请求获取一次性 ticket
const { ticket } = await fetch('/api/ws-ticket', { credentials: 'include' }).then(r => r.json())

// Step 2: 用 ticket 建立 WebSocket（ticket 有效期 30 秒，只能使用一次）
new WebSocket(`ws://localhost:3456/ws?ticket=${ticket}&sessionId=${sessionId}`)
```

> **TUI 本地连接**：通过 Unix Socket 连接时，TUI 读取 `~/.claude-remote/hub.token` 中的主 Token，在握手时发送主 Token。Hub 校验后为该连接签发内存中的会话凭证（与 Web 端 httpOnly cookie 等效，但不需要 HTTP cookie 机制）。主 Token 仅在握手阶段使用一次，后续通信无需重复传递。

**协议版本：**

握手成功后，Hub 发送的首条消息包含协议版本号，客户端校验兼容性：

```typescript
{ type: 'hello'; version: 1; hubVersion: string }
```

版本不兼容时 Hub 返回 `{ type: 'error'; error: 'version_mismatch' }` 并关闭连接。

### 5.2 客户端 → Hub（命令）

所有命令携带客户端生成的 `cmdId`，用于关联 Hub 的 `reply`/`error` 响应：

```typescript
type ClientCommand = { cmdId: string } & (
  // === 用户操作（需要 active writer 权限）===
  | { cmd: 'chat';              text: string; images?: string[] }  // 发送用户消息（Hub 内部构造 SDKUserMessage）
  | { cmd: 'chat:abort' }                                          // 中断当前执行（Hub 内部发 interrupt）
  | { cmd: 'control:respond';   requestId: string; response: SDKControlResponse } // 响应 pending 控制请求
  // === Session 管理 ===
  | { cmd: 'session:create';    cwd: string; name?: string }
  | { cmd: 'session:list' }
  | { cmd: 'session:switch';    sessionId: string }
  | { cmd: 'session:rename';    name: string }
  | { cmd: 'session:archive';   sessionId: string }
  | { cmd: 'session:takeOver' }                                 // 请求接管 active writer
  | { cmd: 'session:takeOver:approve' }                         // 当前 writer 批准接管请求
  | { cmd: 'session:takeOver:reject' }                          // 当前 writer 拒绝接管请求
  | { cmd: 'session:releaseWriter' }                            // 主动释放 writer 权限
  // === 工作目录（需要 active writer 权限）===
  | { cmd: 'cwd:change';        path: string }
  | { cmd: 'cwd:browse';        path: string }                  // viewer 也可用
  | { cmd: 'cwd:favorites' }                                    // viewer 也可用
  | { cmd: 'cwd:addFavorite';   path: string; label?: string }
  // === Skill / 斜杠命令（standby 可查询列表，执行需 active writer）===
  | { cmd: 'skill:list' }                                       // 获取当前 session cwd 下可用的 skill 列表
  | { cmd: 'skill:invoke';     name: string; args?: string }    // 执行 skill（等同于 TUI 中输入 /skill-name args）
  // === 设置与状态（standby 可查询，变更需 active writer）===
  | { cmd: 'config:get' }                                       // 获取当前 session 配置（模型、effort、权限模式等）
  | { cmd: 'config:set';       patch: Partial<SessionConfig> }   // 修改配置项（需 active writer），仅更新传入的字段
  | { cmd: 'context:usage' }                                    // 获取上下文窗口使用情况
  | { cmd: 'cost:get' }                                         // 获取当前 session 费用和用量
  | { cmd: 'mcp:list' }                                         // 获取 MCP 服务列表和状态
  | { cmd: 'mcp:toggle';       serverId: string; enabled: boolean }  // 启用/禁用 MCP 服务（需 active writer）
  | { cmd: 'mcp:reconnect';    serverId: string }               // 重连 MCP 服务（需 active writer）
  // === 对话管理（需 active writer，除 export 外）===
  | { cmd: 'chat:branch';      messageId: string; name?: string }  // 从指定消息创建分支
  | { cmd: 'chat:compact' }                                     // 压缩上下文
  | { cmd: 'chat:export';      format: 'markdown' | 'json' }   // 导出对话（standby 也可用，只读操作）
  | { cmd: 'chat:clear' }                                       // 清空当前对话
  // === 文件浏览（standby 也可用）===
  | { cmd: 'file:read';         path: string; offset?: number; limit?: number }
  | { cmd: 'file:list';         path: string; pattern?: string }
  | { cmd: 'file:search';       pattern: string; path?: string }
  // === 历史搜索（standby 也可用）===
  | { cmd: 'history:search';    query: string; scope: 'session' | 'all'; limit?: number }  // 搜索对话历史（当前 session 或所有 session）
)
```

### 5.3 Hub → 客户端（响应）

```typescript
type HubResponse =
  // 连接握手（WebSocket 协议层，在正式消息之前发送）
  | { type: 'hello';    version: number; hubVersion: string }
  // 状态快照（连接后 / 重连后 / 手动请求时发送）
  | { type: 'snapshot'; snapshot: SessionSnapshot }
  // 增量事件
  | { type: 'event';    event: HubEvent }
  // 命令响应
  | { type: 'reply';    cmdId: string; data: any }
  | { type: 'error';    cmdId: string; error: string }
```

连接建立后，Hub 先发送 `hello`（客户端校验版本），然后发送 `snapshot`，之后增量更新全靠 `event`。

客户端发现事件 `seq` 跳号时，不支持逐条重发，唯一的恢复路径是断开重连获取新的 `snapshot`。

## 6. HTTP REST API

WebSocket 之外的补充 API，适用于简单集成场景（如 curl 调用、CI/CD 触发、第三方工具对接）。完整的实时交互体验请使用 WebSocket：

```
GET    /api/sessions                 # 列出所有 session
GET    /api/sessions/:id             # session 详情 + 最近消息
POST   /api/sessions                 # 创建 session
GET    /api/sessions/:id/messages    # 分页查消息历史
POST   /api/sessions/:id/chat       # 发消息（SSE 流式返回）
GET    /api/files?path=...           # 浏览文件
GET    /api/sessions/:id/skills    # → SkillInfo[]
GET    /api/sessions/:id/context  # → ContextUsage
GET    /api/sessions/:id/cost     # → CostSummary
GET    /api/sessions/:id/config   # → { config: SessionConfig; options: ConfigOptions }
GET    /api/sessions/:id/export   # → 对话内容（?format=markdown|json），无需 active writer
GET    /api/mcp/servers            # → McpServerInfo[]（Hub 全局，非 session 级）
GET    /api/history/search        # → HistorySearchResult[]（?query=...&scope=all|session&sessionId=...&limit=20）
POST   /api/auth/login               # 用主 Token 换取 httpOnly session cookie
POST   /api/ws-ticket                # 获取一次性 WebSocket ticket（30 秒有效）
GET    /api/health                   # 健康检查（无需认证）
```

**认证方式（按客户端类型）：**

| 客户端 | 认证方式 | 说明 |
|---|---|---|
| 浏览器 | httpOnly cookie（自动携带，`credentials: 'include'`） | 通过 `/api/auth/login` 用主 Token 换取 |
| CLI / CI / curl | `Authorization: Bearer <session-jwt>` 请求头 | JWT 通过 `/api/auth/login` 获取，也可用主 Token 直接作为 Bearer |
| WebSocket | 一次性 ticket（见 5.1 节） | 通过 `POST /api/ws-ticket`（需 cookie 或 Bearer）获取 |

> 不支持 `?token=xxx` 查询参数（避免日志泄露）。唯一例外是首次访问的 bootstrap token（见 10.2 节），一次性使用。
> `/api/health` 无需认证。`/api/auth/login` 接受主 Token 作为请求体。

**CSRF 防护：**

- 所有状态变更的 REST 接口要求 `Content-Type: application/json`，利用浏览器 CORS 预检机制天然防护 CSRF
- 可选增加 `X-Requested-With: claude-remote` 自定义头校验

## 7. TUI 客户端改造

### 7.1 改造思路

```
改造前：TUI = AppState + Tool Engine + API Client + Ink 渲染
改造后：TUI = WebSocket 客户端 + Ink 渲染
        Hub = AppState + Tool Engine + API Client + Event Bus
```

TUI 不再直接调用 Claude API 和 Tool，只通过 WebSocket 发命令、收事件。

### 7.2 连接流程

```
claude-remote attach 启动
    │
    ├─ 检测 Hub 是否运行（优先 Unix Socket，回退 TCP）
    │   ├─ 有 → 读 ~/.claude-remote/hub.token → 连接
    │   └─ 无 → fork 子进程启动 Hub → 等待就绪 → 连接
    │
    ├─ 获取 session 列表
    │   ├─ 有活跃 session → 展示选择菜单（或直接 attach 最近的）
    │   └─ 无 → 自动创建新 session（cwd = 当前目录）
    │
    ├─ 进入 Ink REPL，所有操作走 WebSocket
    │
    └─ 连接失败或中途断开
        ├─ 重试 3 次（指数退避）
        └─ 仍失败 → 提示用户，可选进入独立模式
```

### 7.3 需要改造的核心模块

| 模块 | 现状 | 改造后 |
|---|---|---|
| `screens/REPL.tsx` | 直接操作 AppState | 通过 WS 发命令，监听事件渲染 |
| `services/api/claude.ts` | TUI 直接调 | 移到 Hub 内部 |
| `tools/*` | TUI 内执行 | 移到 Hub 内部 |
| `skills/*` | TUI 内加载和执行 | Hub 加载 skill 注册表，通过 `skill:list`/`skill:invoke` 暴露给所有客户端 |
| `state/AppState` | TUI 独占 | Hub 持有，TUI 维护本地只读镜像 |
| 权限弹窗 | TUI 拦截并等用户输入 | Hub 发送 permission:request 给 active writer，standby 客户端仅显示通知（见 10.4 节） |

### 7.4 本地状态镜像

TUI 连接后，Hub 发送当前 session 的完整快照（snapshot），之后通过事件流增量更新。TUI 本地维护一个只读的状态镜像用于 Ink 渲染。

## 8. Web 前端

### 8.1 技术栈

```
React 19 + TypeScript
├── 路由：React Router（SPA，4 个页面）
├── 样式：Tailwind CSS（移动优先）
├── 状态：Zustand（轻量，存 session 镜像）
├── 通信：原生 WebSocket + 自动重连
└── 构建：Bun 打包，Hub 进程 serve 静态文件
```

### 8.2 页面结构

```
/login              → Token 输入页
/sessions           → Session 列表（创建/切换/归档）
/chat/:sessionId    → 主交互页面
/files/:sessionId   → 文件浏览器（也可作为 chat 的 drawer）
```

### 8.3 主交互页面布局（移动端）

```
┌─────────────────────────┐
│ ≡  Session名称  🔔 📁 ⚙ │  ← 顶栏：菜单、session 名、通知、文件、设置
├─────────────────────────┤
│ [cwd: ~/proj/screenpipe]│  ← 当前目录（点击可切换）
│ opus · 42% · $0.12      │  ← 状态条：模型、上下文用量、费用
├─────────────────────────┤
│                         │
│  用户: 帮我重构 auth 模块 │
│                         │
│  AI: 好的，我来分析...    │
│     ┌─ BashTool ──────┐ │
│     │ $ ls src/auth/   │ │  ← 工具调用折叠卡片
│     │ > auth.ts        │ │
│     │ > middleware.ts   │ │
│     └──────────────────┘ │
│                         │
│  权限请求                 │
│  ┌────────────────────┐ │
│  │ 执行: rm -rf dist/ │ │  ← 权限审批卡片
│  │  [拒绝]    [允许]   │ │
│  └────────────────────┘ │
│                         │
├─────────────────────────┤
│ [消息输入...]    [发送]  │  ← 底部输入栏
└─────────────────────────┘
```

### 8.4 核心 UI 组件

| 组件 | 功能 |
|---|---|
| `MessageList` | 消息流，支持流式渲染，markdown 渲染 |
| `ToolCard` | 工具调用结果的折叠卡片（diff 高亮、代码高亮、终端输出） |
| `PermissionBanner` | 权限请求通知 + 批准/拒绝按钮 |
| `SessionSwitcher` | 侧边抽屉，session 列表 + 创建 |
| `CwdPicker` | 下拉收藏目录 + 文件树浏览器 |
| `TaskPanel` | 任务列表面板（抽屉式） |
| `FileViewer` | 文件内容查看，语法高亮（Shiki） |
| `StreamingText` | 流式文字渲染，打字机效果 |
| `SkillPalette` | 斜杠命令面板（`/` 触发，模糊搜索，参数提示） |
| `ModelSelector` | 模型切换下拉（含 effort 级别） |
| `ContextIndicator` | 上下文用量指示器（顶栏百分比 + 点击展开详情） |
| `CostBadge` | 费用显示（顶栏摘要 + 点击展开详情） |
| `McpPanel` | MCP 服务管理面板（列表、状态、开关、重连） |
| `BranchMenu` | 对话分支操作（消息长按/右键 → "从这里分支"） |
| `ExportDialog` | 导出对话弹窗（格式选择 + 下载/复制） |
| `HistorySearch` | 对话历史搜索（全文搜索 + 结果预览） |
| `NotificationCenter` | 通知中心（顶栏铃铛 + 下拉列表） |
| `SettingsDrawer` | 设置抽屉（模型、权限、MCP、费用等 tab） |
| `CompactPrompt` | 上下文满时的压缩提示条 |
| `PlanViewer` | Plan 模式查看器（只读展示 + 编辑入口） |

### 8.5 Skill / 斜杠命令支持

Web 端完整支持 TUI 中的斜杠命令体验：

**发现与展示：**

- 连接时 snapshot 包含 `availableSkills[]`，Web 端缓存到 Zustand store
- cwd 切换时 Hub 推送更新的 skill 列表（不同项目可能有不同的 `.claude/skills/`）
- `SkillPalette` 组件在输入框中检测 `/` 前缀时弹出，使用 Fuse.js 模糊搜索（复用 TUI 的搜索权重策略）

**执行流程：**

```
用户在 Web 输入框输入 "/commit -m 'fix bug'"
    │
    ├─ 客户端解析：name="commit", args="-m 'fix bug'"
    ├─ 发送 { cmd: 'skill:invoke', name: 'commit', args: "-m 'fix bug'" }
    │
    ├─ Hub 收到后：
    │   ├─ 查找 skill 注册表，验证 skill 存在且 userInvocable=true
    │   ├─ 加载 skill 完整内容（SKILL.md prompt）
    │   ├─ 按 skill 配置选择执行方式：
    │   │   ├─ inline → 将 skill prompt 展开为对话消息，Claude 按提示执行
    │   │   └─ fork → 启动子 agent 在独立上下文中执行，结果回传
    │   └─ 执行过程中的 SDK 消息正常通过 Event Bus 推送给所有客户端
    │
    └─ Web 端正常渲染流式响应、工具调用卡片等（与 chat 完全一致）
```

**权限要求：** `skill:invoke` 需要 active writer 权限。`skill:list` 任何客户端都可调用。

**限制：** 内置 CLI 命令（如 `/help`、`/clear`、`/config`）是 TUI 本地操作，不通过 Hub 暴露。Web 端提供等效的 UI 操作（设置页面、清空对话按钮等）。

### 8.6 TUI 功能对齐

除了基础的 chat/tool/permission/file/skill 之外，Web 端还需要覆盖以下 TUI 功能：

#### 8.6.1 模型与配置

- **模型切换**：`ModelSelector` 下拉，显示可用模型列表 + 当前模型，切换时发 `config:set`
- **Effort 级别**：集成在 ModelSelector 中（low/medium/high 三档）
- **权限模式**：设置抽屉中切换 ask/approve/bypass

#### 8.6.2 上下文与费用

- **上下文指示器**：状态条常驻显示百分比，点击展开详情（按类别的 token 分布柱状图）
- **费用显示**：状态条常驻显示累计费用，点击展开详情（input/output tokens、API 调用次数、session 时长）
- **上下文压缩**：用量超过 80% 时显示 `CompactPrompt` 提示条，点击触发 `chat:compact`

#### 8.6.3 对话管理

- **对话分支**：消息气泡长按/右键弹出菜单 → "从这里分支"，创建新的对话分支（`chat:branch`）
- **导出**：设置抽屉或菜单中 → "导出对话"，支持 Markdown 和 JSON 格式
- **清空对话**：设置抽屉中，带二次确认
- **历史搜索**：Session 列表页的搜索框，全文搜索对话历史

#### 8.6.4 MCP 服务管理

`McpPanel` 作为设置抽屉的一个 tab：

```
┌─ MCP 服务 ───────────────┐
│                           │
│  ✅ filesystem    3 tools │  ← 状态 + tool 数量
│     [关闭]  [重连]        │
│                           │
│  ❌ database      error   │
│     连接失败: timeout     │
│     [开启]  [重连]        │
│                           │
│  ⏸ slack         5 tools │
│     [开启]  [重连]        │
│                           │
└───────────────────────────┘
```

- 显示每个 MCP 服务的名称、状态、tool 数量
- 支持启用/禁用（`mcp:toggle`）和重连（`mcp:reconnect`）
- 状态变化通过 `hub:mcp:statusChanged` 事件实时更新

#### 8.6.5 通知系统

`NotificationCenter` 聚合以下通知来源：

| 通知类型 | 触发条件 |
|---|---|
| 权限请求 | Tool 需要审批（active writer 专属） |
| 上下文预警 | 用量超过 80% |
| MCP 异常 | 服务断开或报错 |
| 分支创建 | 其他客户端创建了分支 |
| Writer 变更 | active writer 身份变化 |
| Hub 关闭 | 收到 `hub:shutdown` |

可选增强：Service Worker Push Notification，手机锁屏也能收到权限请求通知。

#### 8.6.6 Plan 模式

- 收到 SDK 层的 plan 相关消息时，`PlanViewer` 以结构化方式展示计划内容
- active writer 可批准/拒绝计划中的步骤

#### 8.6.7 功能边界：Web 端不提供的 TUI 功能

以下功能属于终端专属或移动端不适用，Web 端不实现：

| 功能 | 不提供原因 |
|---|---|
| Vim 模式、主题、终端颜色 | 终端渲染专属 |
| IDE 集成（连接/断开 IDE） | 需要本地 IDE 进程 |
| 快捷键编辑器 | 移动端无物理键盘快捷键 |
| 终端设置 (`/terminalsetup`) | Shell 集成，终端专属 |
| Desktop handoff | Claude Desktop 专属 |
| Chrome 扩展管理 | 独立产品，非 CLI 核心功能 |
| GitHub/Slack App 安装向导 | 多步 OAuth 流程，不适合手机操作 |
| Doctor 诊断 | 本地环境诊断工具 |
| 状态栏位置/显隐 | 终端 UI 布局控制 |
| Release notes / 版本更新 | Hub 管理，非 Web 端职责 |

### 8.7 离线/断线处理

```
WebSocket 断开
    │
    ├─ 显示 "重连中..." 横幅
    ├─ 指数退避自动重连（1s → 2s → 4s → 最大 30s）
    ├─ 重连成功 → 请求 snapshot 恢复状态
    └─ 超过 2 分钟 → 提示 "Hub 可能已停止"
```

### 8.8 UI 设计

使用 Google Stitch MCP 进行界面设计，移动优先，确保手机端操作体验流畅。

## 9. 目录管理 + 文件浏览器

### 9.1 收藏目录

```typescript
interface FavoriteDir {
  id: string
  path: string           // 绝对路径
  label: string          // 显示名，如 "screenpipe"
  lastUsed: number       // 最近使用时间，排序用
}
```

- 每次创建 session 时自动将 cwd 加入收藏（去重）
- 用户可手动添加/删除/重命名
- 按最近使用时间排序

### 9.2 CwdPicker 交互

点击顶部目录栏弹出底部抽屉：

- **收藏目录** — 常用项目快捷切换
- **浏览文件系统** — 进入文件树浏览器
- **最近使用** — 自动记录的历史目录

### 9.3 文件浏览器

- 树状目录浏览，点击进入子目录
- 点击文件预览内容（语法高亮）
- 长按目录添加到收藏
- 搜索框快速过滤
- 安全限制：
  - **白名单机制**：可配置允许浏览的根目录列表（默认 `$HOME`），仅允许访问白名单内的路径
  - 所有路径在检查前先解析符号链接（`realpath`），防止通过 symlink 或 `../` 绕过限制
  - 默认排除 `.ssh`、`.gnupg`、`.claude-remote` 等敏感目录

### 9.4 文件查看器

- 语法高亮（Shiki，支持主流语言）
- Diff 高亮（工具编辑结果）
- 行号显示
- 大文件分页加载（每次 100 行，滚动加载更多）
- 双指缩放字体大小

## 10. Cloudflare Tunnel + 安全

### 10.1 Tunnel 集成

```bash
claude-remote serve --tunnel    # 启动 Hub + 自动创建 Cloudflare Tunnel
```

流程：

1. 检测 `cloudflared` 是否已安装
2. 启动 `cloudflared tunnel --url localhost:3456`
3. 解析输出获取公网 URL
4. 生成带一次性 bootstrap token 的访问链接（5 分钟有效，使用后立即失效）
5. 终端打印 URL + QR Code（手机扫码即用，扫码后自动通过 httpOnly cookie 签发会话 Token）

支持 Quick Tunnel（免配置）和用户自配置的命名 Tunnel。

### 10.2 Token 认证

**主 Token（Master Token）：**

```typescript
const masterToken = crypto.randomUUID()
// 持久化到 ~/.claude-remote/hub.token
// 仅用于首次认证（Web 登录页、TUI Unix Socket 握手），成功后签发会话凭证
// 不在后续 API 请求中使用
```

**会话 Token（Session Token）：**

- 主 Token 用于首次认证，成功后 Hub 签发短期会话 Token（JWT，默认 7 天有效）
- 所有后续 API 请求和 WebSocket 连接使用会话 Token
- 会话 Token 过期后需用主 Token 重新认证
- **滑动续期**：客户端在会话 Token 剩余有效期不足 1 天时，Hub 自动在响应中通过 `Set-Cookie` 签发新的会话 Token，无需用户操作

**Web 认证流程：**

1. 首次访问：URL 带一次性 bootstrap token（`?init_token=xxx`），该 token 5 分钟内有效且只能使用一次
2. Hub 校验 bootstrap token → 签发会话 Token → 通过 `Set-Cookie: session=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/` 写入 httpOnly cookie
3. 通过 `history.replaceState` 立即清除 URL 中的 bootstrap token
4. 跳转 /sessions
5. 无 token → 显示 /login 页面 → 手动输入主 Token → 同样通过 httpOnly cookie 签发会话

> **安全说明**：会话 Token 存储在 httpOnly cookie 中，JavaScript 无法读取，XSS 攻击无法窃取凭证。不使用 localStorage 存储任何 token。WebSocket 连接通过先发 HTTP 请求获取一次性 WS ticket（有效期 30 秒），再用 ticket 建立 WebSocket，避免在 WS URL 或头中传递长期凭证。

**可选增强：** 支持 TOTP 二次验证，通过 `claude-remote token --totp` 启用。

### 10.3 安全措施

| 层级 | 措施 |
|---|---|
| 传输层 | Cloudflare Tunnel 自带 HTTPS |
| 认证 | 主 Token + 会话 Token 双层认证，会话 Token 存 httpOnly cookie（7 天有效），XSS 无法窃取 |
| 限流 | 连续 5 次认证失败 → 按请求指纹（User-Agent + 时间窗口）限流 10 分钟（不依赖 IP，因为 Tunnel 下 IP 不可靠） |
| Token 轮换 | `claude-remote token rotate` 重新生成主 Token，所有已签发的会话 Token 立即失效。已连接的 WebSocket 客户端收到 `{ type: 'hub:auth:revoked' }` 事件后断开，需用新主 Token 重新认证 |
| CSRF 防护 | 状态变更接口要求 `Content-Type: application/json` + 可选 `X-Requested-With` 头 |
| 路径遍历防护 | 文件浏览器使用白名单 + `realpath` 解析符号链接 |

### 10.4 权限模型

```
Tool 请求执行敏感操作
    │
    ├─ Hub 检查权限策略
    │   ├─ 已授权 → 直接执行
    │   └─ 需审批 → 发送 sdk:control（can_use_tool）给 active writer
    │
    ├─ active writer 收到权限请求
    │   ├─ TUI → 显示权限弹窗
    │   └─ Web → 显示审批卡片 + 推送通知
    │
    ├─ active writer 响应 → Hub 执行/拒绝 → 广播结果给所有客户端
    │
    └─ active writer 60 秒无响应 → 降级广播给所有 standby 客户端
        └─ 任意 standby 响应 → Hub 执行/拒绝 → 广播结果
```

**写入所有权模型（Active Writer）：**

> 每个 session 使用**单一维度**的客户端状态：`active`（写入者）或 `standby`（观察者）。不再使用 admin/viewer 角色概念，避免两个维度混淆。

**命令级权限矩阵：**

| 命令 | active writer | standby |
|---|---|---|
| `chat`、`chat:abort` | 允许 | 拒绝 |
| `control:respond` | 允许 | 仅权限降级场景（见上文） |
| `config:set` | 允许 | 拒绝 |
| `cwd:change`、`cwd:addFavorite` | 允许 | 拒绝 |
| `chat:branch`、`chat:compact`、`chat:clear` | 允许 | 拒绝 |
| `skill:invoke` | 允许 | 拒绝 |
| `mcp:toggle`、`mcp:reconnect` | 允许 | 拒绝 |
| `session:takeOver`、`session:releaseWriter` | 允许（takeOver 可由 standby 发起请求） | takeOver 可发起 |
| `session:create/list/switch/rename/archive` | 允许 | 允许 |
| `config:get`、`context:usage`、`cost:get` | 允许 | 允许 |
| `skill:list`、`mcp:list` | 允许 | 允许 |
| `chat:export`、`history:search` | 允许 | 允许（只读操作） |
| `cwd:browse`、`cwd:favorites` | 允许 | 允许 |
| `file:read/list/search` | 允许 | 允许 |

Hub 对 standby 客户端发来的写入命令返回 `{ type: 'error'; cmdId: string; error: 'writer_required' }`。

**所有权规则：**

```
客户端连接到 session
    │
    ├─ session 无 active writer → 自动成为 active writer
    ├─ session 已有 active writer → 以 standby 身份连接
    │
    └─ active writer 断开连接
        ├─ Hub 加锁序列化处理，取连接时间最早的 standby 提升
        │   （多客户端同时重连时，仅第一个获得锁的成为 writer）
        └─ 无其他客户端 → session 变为无 writer 状态
```

- 客户端可主动请求接管写入权：`{ cmd: 'session:takeOver' }`，当前 writer 收到 `hub:takeOver:request` 事件，30 秒内可批准或拒绝，超时视为拒绝
- TUI 连接默认请求 active writer（如已有 writer 则自动发 takeOver），Web 连接默认 standby（可手动接管）

可选增强：Web 端注册 Service Worker，权限请求到来时发 Push Notification，手机锁屏也能收到。

## 11. 生命周期管理

### 11.1 优雅关闭

Hub 进程收到 `SIGTERM` 或 `SIGINT` 时：

1. 停止接受新的 WebSocket 连接和 HTTP 请求
2. 向所有已连接客户端广播 `{ type: 'hub:shutdown' }` 事件
3. 等待正在执行的 Tool 完成（最多等待 30 秒）
4. 超时未完成的 Tool 记录为 `interrupted` 状态，写入 `tool_executions` 表
5. 将所有活跃 session 状态落盘到 SQLite
6. 关闭 Cloudflare Tunnel 子进程（如有）
7. 关闭所有 WebSocket 连接
8. 退出进程

```bash
claude-remote stop          # 向 Hub 发送 SIGTERM，触发优雅关闭
claude-remote status        # 查看 Hub 运行状态
```

### 11.2 崩溃恢复

> **重要限制**：Hub 的 SQLite 只持久化对话记录和任务元数据，**不持久化运行时状态**（运行中的 bash 进程、pending 权限请求、MCP 连接、输出流偏移量等）。崩溃恢复的目标是**恢复对话上下文**，不是恢复中断的工作流。

Hub 非正常退出后重启时：

1. 从 SQLite 恢复未归档的 session（仅对话历史 + 任务列表）
2. 将所有恢复的 session 状态标记为 `interrupted`（不是 `active`）
3. 检查 `tool_executions` 表中状态为 `running` 的记录，标记为 `crashed`
4. 向 session 追加系统消息，列出中断的工具执行
5. 客户端重连后看到 `interrupted` 状态的 session，可选择：
   - **继续对话**：session 恢复为 `active`，用户可基于历史上下文继续提问
   - **归档**：标记为 `archived`

**不恢复的内容：**
- 运行中的 bash/shell 子进程（已随 Hub 进程死亡）
- pending 的权限审批请求（需要重新触发）
- MCP server 连接状态（需重新建立）
- 流式输出的中间状态（丢失未落盘的 streaming delta）

## 12. 配置管理

Hub 的配置文件位于 `~/.claude-remote/config.toml`：

```toml
[server]
port = 3456
log_level = "info"          # debug / info / warn / error

[limits]
max_sessions = 10
max_messages_in_memory = 1000
max_concurrent_tools = 5
max_connections_per_session = 10
idle_timeout_ms = 1800000       # 30 分钟无客户端连接后 session 变为 idle

[auth]
session_token_ttl = "7d"    # 会话 Token 有效期
totp_enabled = false        # 是否启用 TOTP 二次验证

[files]
allowed_roots = ["~"]       # 文件浏览器白名单根目录
excluded_dirs = [".ssh", ".gnupg", ".claude-remote"]

[tunnel]
auto_start = false          # serve 时是否自动启动 tunnel
provider = "cloudflare"     # 目前仅支持 cloudflare
```

配置优先级：命令行参数 > 环境变量（`CLAUDE_REMOTE_*`）> 配置文件 > 默认值。

## 13. 日志与可观测性

Hub 作为常驻后台进程，需要结构化日志：

- **日志位置**：`~/.claude-remote/logs/hub.log`，按日期轮转（保留 7 天，单文件最大 50MB）
- **日志级别**：`debug` / `info` / `warn` / `error`，通过 `--log-level` 启动参数或环境变量 `CLAUDE_REMOTE_LOG_LEVEL` 控制（默认 `info`）
- **结构化格式**：JSON lines，包含 `timestamp`、`level`、`sessionId`（如有）、`message`、`data`
- **关键日志事件**：session 创建/销毁、客户端连接/断开、tool 执行开始/完成/失败、认证失败、Tunnel 状态变化

```bash
claude-remote logs              # tail -f 实时查看日志
claude-remote logs --level error  # 只看错误
```

**Health 端点（`GET /api/health`）返回：**

```json
{
  "status": "ok",
  "uptime": 86400,
  "sessions": { "active": 3, "idle": 2, "total": 5 },
  "clients": { "connected": 4 },
  "tools": { "running": 1, "queued": 0 },
  "tunnel": { "status": "connected", "url": "https://xxx.trycloudflare.com" },
  "memory": { "heapUsedMB": 128 }
}
```

`claude-remote status` 命令调用此端点并格式化输出。

## 14. 补充说明

### session:switch 语义

客户端发送 `cmd: 'session:switch'` 时，Hub 将该 WebSocket 连接从当前 session 的订阅列表移到目标 session，**不需要断开重连**。Hub 发送目标 session 的 `snapshot` 作为 `reply`，客户端用新 snapshot 替换本地状态。

### file:read 路径安全

`file:read` 命令与文件浏览器共享同一套路径校验逻辑（白名单 + `realpath`），不允许读取白名单范围外的文件。

## 15. 新增文件结构

```
src/
├── entrypoints/
│   └── serve.ts                 # Hub 服务入口（新增）
├── hub/                         # Hub 核心（新增）
│   ├── Hub.ts                   # Hub 主类，管理 session 生命周期 + 优雅关闭
│   ├── SessionManager.ts        # Session CRUD + 状态管理 + 资源限制
│   ├── EventBus.ts              # 事件广播系统（含序列号 + 背压）
│   ├── ToolEngine.ts            # Tool 执行引擎（包装现有 tools）
│   ├── ClaudeClient.ts          # Claude API 调用（包装现有 api client）
│   └── store/
│       ├── SqliteStore.ts       # SQLite 持久化层
│       ├── schema.sql           # 表结构定义
│       └── migrations/          # 数据库迁移脚本
├── server/                      # HTTP/WS 服务（新增）
│   ├── index.ts                 # Hono app 创建
│   ├── routes/
│   │   ├── sessions.ts          # /api/sessions
│   │   ├── files.ts             # /api/files
│   │   ├── skills.ts            # /api/sessions/:id/skills
│   │   ├── config.ts            # /api/sessions/:id/config, context, cost
│   │   ├── mcp.ts               # /api/mcp/servers
│   │   └── health.ts            # /api/health
│   ├── ws/
│   │   ├── handler.ts           # WebSocket 连接管理
│   │   └── protocol.ts          # 协议类型定义
│   └── auth/
│       ├── token.ts             # 主 Token + 会话 Token（JWT）生成/验证
│       └── middleware.ts        # 认证 + CSRF 防护中间件
├── web/                         # Web 前端（新增）
│   ├── index.html
│   ├── App.tsx
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Sessions.tsx
│   │   ├── Chat.tsx
│   │   └── Files.tsx
│   ├── components/
│   │   ├── MessageList.tsx
│   │   ├── ToolCard.tsx
│   │   ├── PermissionBanner.tsx
│   │   ├── SessionSwitcher.tsx
│   │   ├── CwdPicker.tsx
│   │   ├── TaskPanel.tsx
│   │   ├── FileViewer.tsx
│   │   ├── StreamingText.tsx
│   │   ├── SkillPalette.tsx
│   │   ├── ModelSelector.tsx
│   │   ├── ContextIndicator.tsx
│   │   ├── CostBadge.tsx
│   │   ├── McpPanel.tsx
│   │   ├── BranchMenu.tsx
│   │   ├── ExportDialog.tsx
│   │   ├── HistorySearch.tsx
│   │   ├── NotificationCenter.tsx
│   │   ├── SettingsDrawer.tsx
│   │   ├── CompactPrompt.tsx
│   │   └── PlanViewer.tsx
│   ├── hooks/
│   │   ├── useWebSocket.ts      # WebSocket 连接 + 自动重连
│   │   └── useSessionStore.ts   # Zustand session 状态
│   └── styles/
│       └── tailwind.css
├── tunnel/                      # Cloudflare Tunnel（新增）
│   └── cloudflared.ts           # 启动/管理 tunnel 进程
└── shared/                      # 前后端共享类型（新增）
    ├── types.ts                 # Session, Message, Task 等类型
    ├── protocol.ts              # ClientCommand, HubResponse, HubEvent
    └── constants.ts             # 端口、路径等常量
```

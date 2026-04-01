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
       │ WebSocket         │ 内部 API          │
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

### 2.3 与现有代码的关系

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

**本地通信：**

TUI 与 Hub 之间优先使用 Unix Socket（`~/.claude-remote/hub.sock`）而非 TCP WebSocket，减少本地通信开销，避免不必要的网络依赖。

### 3.2 Session 数据模型

```typescript
interface Session {
  id: string                    // uuid
  name: string                  // 用户可命名，如 "screenpipe 重构"
  cwd: string                   // 工作目录
  createdAt: number
  updatedAt: number
  status: 'active' | 'idle' | 'archived'
  messages: Message[]           // 对话历史（复用现有 Message 类型）
  tasks: Task[]                 // 任务列表
  pendingPermissions: PermissionRequest[]  // 等待审批的权限请求
  clients: ClientConnection[]   // 当前连接的客户端列表
}

interface ClientConnection {
  id: string
  type: 'tui' | 'web'
  role: 'admin' | 'viewer'   // admin 可审批权限，viewer 只能观察
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

**策略：**

- SQLite 启用 **WAL 模式**（`PRAGMA journal_mode=WAL`），支持并发读写，避免流式消息高频写入时阻塞读操作
- `message:streaming` 事件不逐 delta 写入 SQLite，仅在 `message:done` 时写入完整消息，减少写入压力
- 内存中维护活跃 session 的状态
- SQLite 做异步落盘（消息完成时写入）
- Hub 启动时从 SQLite 恢复未归档的 session
- Hub 启动时检查 `tool_executions` 中状态为 `running` 的记录，标记为 `failed`（崩溃恢复）

**资源限制：**

| 资源 | 默认上限 |
|---|---|
| 活跃 session 数 | 10 |
| 单 session 内存中消息数 | 1000（更早的消息从 SQLite 按需加载） |
| 并发工具执行数 | 5（跨所有 session） |
| 单 session WebSocket 连接数 | 10 |

## 4. Event Bus

### 4.1 事件类型

```typescript
type HubEvent =
  // 对话
  | { type: 'message:added';      sessionId: string; message: Message }
  | { type: 'message:streaming';  sessionId: string; delta: StreamDelta }
  | { type: 'message:done';       sessionId: string; messageId: string }
  // 工具
  | { type: 'tool:start';         sessionId: string; toolUse: ToolUseBlock }
  | { type: 'tool:output';        sessionId: string; toolId: string; chunk: string }
  | { type: 'tool:done';          sessionId: string; toolId: string; result: ToolResult }
  // 权限
  | { type: 'permission:request';  sessionId: string; request: PermissionRequest }
  | { type: 'permission:resolved'; sessionId: string; requestId: string; granted: boolean }
  // 任务
  | { type: 'task:updated';       sessionId: string; task: Task }
  // Session
  | { type: 'session:created';    session: SessionMeta }
  | { type: 'session:cwdChanged'; sessionId: string; cwd: string }
  | { type: 'client:joined';      sessionId: string; client: ClientConnection }
  | { type: 'client:left';        sessionId: string; clientId: string }
```

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

// 消息序列化：messages 表的 content 字段存储为 JSON text
// 完整保留 Claude API 的多部分 content 结构（text、tool_use、tool_result、image 等）
// 示例：[{"type":"text","text":"..."},{"type":"tool_use","id":"...","name":"BashTool","input":{...}}]
```

### 4.2 广播机制

- Hub 维护一个 `Map<sessionId, Set<WebSocket>>` 映射
- 事件产生时，广播给该 session 下所有已连接的 WebSocket
- 同时异步写入 SQLite（消息和任务事件）

**顺序保证：**

- 每个事件携带单调递增的 `seq` 序列号（每 session 独立计数）
- 客户端按 `seq` 排序处理事件，发现跳号时请求重发或拉取 snapshot
- SQLite 写入在广播之前完成（先持久化，再推送），确保崩溃恢复时不丢事件

**慢客户端背压：**

- 每个 WebSocket 连接维护发送队列，队列深度超过 500 条时开始合并 `message:streaming` 事件（只保留最新 delta）
- 队列深度超过 2000 条时断开连接，客户端重连后通过 snapshot 恢复

## 5. WebSocket 协议

### 5.1 连接

```
ws://localhost:3456/ws?sessionId=yyy
```

WebSocket 握手时通过 `Sec-WebSocket-Protocol` 子协议头传递 token（避免 token 出现在 URL 中被日志记录）：

```typescript
new WebSocket(url, [`token.${sessionToken}`])
```

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
  // 对话
  | { cmd: 'chat';              text: string }
  | { cmd: 'chat:abort' }
  // Session
  | { cmd: 'session:create';    cwd: string; name?: string }
  | { cmd: 'session:list' }
  | { cmd: 'session:switch';    sessionId: string }
  | { cmd: 'session:rename';    name: string }
  | { cmd: 'session:archive';   sessionId: string }
  // 工作目录
  | { cmd: 'cwd:change';        path: string }
  | { cmd: 'cwd:browse';        path: string }
  | { cmd: 'cwd:favorites' }
  | { cmd: 'cwd:addFavorite';   path: string; label?: string }
  // 权限
  | { cmd: 'permission:grant';  requestId: string }
  | { cmd: 'permission:deny';   requestId: string }
  // 任务
  | { cmd: 'task:create';       subject: string; description: string }
  | { cmd: 'task:update';       taskId: string; status: string }
  // 文件
  | { cmd: 'file:read';         path: string; offset?: number; limit?: number }
  | { cmd: 'file:list';         path: string; pattern?: string }
  | { cmd: 'file:search';       pattern: string; path?: string }
)
```

### 5.3 Hub → 客户端（响应）

```typescript
type HubResponse =
  | { type: 'snapshot';  session: Session; recentMessages: Message[]; activeTasks: Task[]; pendingPermissions: PermissionRequest[] }
  | { type: 'event';    event: HubEvent }
  | { type: 'reply';    cmdId: string; data: any }
  | { type: 'error';    cmdId: string; error: string }
```

连接建立后，Hub 立即发送 `snapshot`，之后增量更新全靠 `event`。

## 6. HTTP REST API

WebSocket 之外的补充 API，适用于简单集成场景（如 curl 调用、CI/CD 触发、第三方工具对接）。完整的实时交互体验请使用 WebSocket：

```
GET    /api/sessions                 # 列出所有 session
GET    /api/sessions/:id             # session 详情 + 最近消息
POST   /api/sessions                 # 创建 session
GET    /api/sessions/:id/messages    # 分页查消息历史
POST   /api/sessions/:id/chat       # 发消息（SSE 流式返回）
GET    /api/files?path=...           # 浏览文件
GET    /api/health                   # 健康检查
```

Token 通过 `Authorization: Bearer xxx` 传递。

> **注意**：不支持 `?token=xxx` 查询参数方式，避免 token 泄露到服务器日志和浏览器历史中。唯一例外是首次访问链接（见 10.2 节），该 token 为一次性使用。

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
| `state/AppState` | TUI 独占 | Hub 持有，TUI 维护本地只读镜像 |
| 权限弹窗 | TUI 拦截并等用户输入 | Hub 广播 permission:request，任何客户端可响应 |

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
│ ≡  Session名称   📁  ⚙  │  ← 顶栏：菜单、session 名、文件/设置
├─────────────────────────┤
│ [cwd: ~/proj/screenpipe]│  ← 当前目录（点击可切换）
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

### 8.5 离线/断线处理

```
WebSocket 断开
    │
    ├─ 显示 "重连中..." 横幅
    ├─ 指数退避自动重连（1s → 2s → 4s → 最大 30s）
    ├─ 重连成功 → 请求 snapshot 恢复状态
    └─ 超过 2 分钟 → 提示 "Hub 可能已停止"
```

### 8.6 UI 设计

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
4. 生成带 token 的完整访问链接
5. 终端打印 URL + QR Code（手机扫码即用）

支持 Quick Tunnel（免配置）和用户自配置的命名 Tunnel。

### 10.2 Token 认证

**主 Token（Master Token）：**

```typescript
const masterToken = crypto.randomUUID()
// 持久化到 ~/.claude-remote/hub.token
// TUI 启动时自动读取
// 仅用于生成会话 Token，不直接用于 API 请求
```

**会话 Token（Session Token）：**

- 主 Token 用于首次认证，成功后 Hub 签发短期会话 Token（JWT，默认 7 天有效）
- 所有后续 API 请求和 WebSocket 连接使用会话 Token
- 会话 Token 过期后需用主 Token 重新认证

**Web 认证流程：**

1. 首次访问：URL 带一次性 token（`?init_token=xxx`）
2. Hub 校验后签发会话 Token → 写入 localStorage
3. 通过 `history.replaceState` 立即清除 URL 中的 token
4. 跳转 /sessions
5. 无 token → 显示 /login 页面 → 手动输入主 Token

**可选增强：** 支持 TOTP 二次验证，通过 `claude-remote token --totp` 启用。

### 10.3 安全措施

| 层级 | 措施 |
|---|---|
| 传输层 | Cloudflare Tunnel 自带 HTTPS |
| 认证 | 主 Token + 会话 Token 双层认证，会话 Token 7 天有效 |
| 限流 | 连续 5 次认证失败 → 按请求指纹（User-Agent + 时间窗口）限流 10 分钟（不依赖 IP，因为 Tunnel 下 IP 不可靠） |
| Token 轮换 | `claude-remote token rotate` 重新生成主 Token，所有已签发的会话 Token 立即失效 |
| CSRF 防护 | 状态变更接口要求 `Content-Type: application/json` + 可选 `X-Requested-With` 头 |
| 路径遍历防护 | 文件浏览器使用白名单 + `realpath` 解析符号链接 |

### 10.4 权限模型

```
Tool 请求执行敏感操作
    │
    ├─ Hub 检查权限策略
    │   ├─ 已授权 → 直接执行
    │   └─ 需审批 → 广播 permission:request 事件
    │
    ├─ 所有已连接客户端都收到通知
    │   ├─ TUI → 显示权限弹窗
    │   └─ Web → 显示审批卡片 + 推送通知（Service Worker）
    │
    └─ 仅 role=admin 的客户端可响应 → Hub 执行/拒绝 → 广播结果
```

**客户端角色：**

- `admin`：可发送消息、审批权限请求、管理 session（TUI 默认为 admin）
- `viewer`：只能观察对话和工具执行，不能审批权限或发送消息

通过连接时指定角色或在 Hub 配置中设定，Web 端首次连接默认为 admin，可在设置中降级为 viewer。

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

Hub 非正常退出后重启时：

1. 从 SQLite 恢复未归档的 session
2. 检查 `tool_executions` 表中状态为 `running` 的记录，标记为 `failed`
3. 向 session 追加一条系统消息："Hub 异常重启，以下工具执行被中断：..."
4. 客户端重连后通过 snapshot 获取恢复后的状态

## 12. 日志与可观测性

Hub 作为常驻后台进程，需要结构化日志：

- **日志位置**：`~/.claude-remote/logs/hub.log`，按日期轮转（保留 7 天）
- **日志级别**：`debug` / `info` / `warn` / `error`，通过 `--log-level` 启动参数或环境变量 `CLAUDE_REMOTE_LOG_LEVEL` 控制（默认 `info`）
- **结构化格式**：JSON lines，包含 `timestamp`、`level`、`sessionId`（如有）、`message`、`data`
- **关键日志事件**：session 创建/销毁、客户端连接/断开、tool 执行开始/完成/失败、认证失败、Tunnel 状态变化

```bash
claude-remote logs              # tail -f 实时查看日志
claude-remote logs --level error  # 只看错误
```

## 13. 补充说明

### session:switch 语义

客户端发送 `cmd: 'session:switch'` 时，Hub 将该 WebSocket 连接从当前 session 的订阅列表移到目标 session，**不需要断开重连**。Hub 发送目标 session 的 `snapshot` 作为 `reply`，客户端用新 snapshot 替换本地状态。

### file:read 路径安全

`file:read` 命令与文件浏览器共享同一套路径校验逻辑（白名单 + `realpath`），不允许读取白名单范围外的文件。

## 14. 新增文件结构

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
│       └── schema.sql           # 表结构定义
├── server/                      # HTTP/WS 服务（新增）
│   ├── index.ts                 # Hono app 创建
│   ├── routes/
│   │   ├── sessions.ts          # /api/sessions
│   │   ├── files.ts             # /api/files
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
│   │   └── StreamingText.tsx
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

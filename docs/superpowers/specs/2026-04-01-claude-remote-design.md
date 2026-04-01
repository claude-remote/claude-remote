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
| TUI 连接 | `claude-remote` |
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
claude-remote              # 检测本地有无 Hub 在跑
                           # 有 → 连接 Hub，作为 TUI 客户端
                           # 无 → 自动启动 Hub + 连接
```

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

**策略：**

- 内存中维护活跃 session 的状态
- SQLite 做异步落盘（消息到达时立即写入）
- Hub 启动时从 SQLite 恢复未归档的 session

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

### 4.2 广播机制

- Hub 维护一个 `Map<sessionId, Set<WebSocket>>` 映射
- 事件产生时，广播给该 session 下所有已连接的 WebSocket
- 同时异步写入 SQLite（消息和任务事件）

## 5. WebSocket 协议

### 5.1 连接

```
ws://localhost:3456/ws?token=xxx&sessionId=yyy
```

### 5.2 客户端 → Hub（命令）

```typescript
type ClientCommand =
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

WebSocket 之外的补充 API：

```
GET    /api/sessions                 # 列出所有 session
GET    /api/sessions/:id             # session 详情 + 最近消息
POST   /api/sessions                 # 创建 session
GET    /api/sessions/:id/messages    # 分页查消息历史
POST   /api/sessions/:id/chat       # 发消息（SSE 流式返回）
GET    /api/files?path=...           # 浏览文件
GET    /api/health                   # 健康检查
```

Token 通过 `Authorization: Bearer xxx` 或 `?token=xxx` 传递。

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
claude-remote 启动
    │
    ├─ 检测 localhost:3456 是否有 Hub 运行
    │   ├─ 有 → 读 ~/.claude-remote/hub.token → 连接 WebSocket
    │   └─ 无 → fork 子进程启动 Hub → 等待就绪 → 连接
    │
    ├─ 获取 session 列表
    │   ├─ 有活跃 session → 展示选择菜单（或直接 attach 最近的）
    │   └─ 无 → 自动创建新 session（cwd = 当前目录）
    │
    └─ 进入 Ink REPL，所有操作走 WebSocket
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
├── 路由：React Router（SPA，3-4 个页面）
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
- 安全限制：可配置可浏览的根目录范围（默认 `$HOME`），隐藏 `.ssh`、`.gnupg` 等敏感目录

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

```typescript
const token = crypto.randomUUID()
// 持久化到 ~/.claude-remote/hub.token
// TUI 启动时自动读取
```

**Web 认证流程：**

- URL 带 token → 自动认证 → 写入 localStorage → 跳转 /sessions
- 无 token → 显示 /login 页面 → 手动输入

### 10.3 安全措施

| 层级 | 措施 |
|---|---|
| 传输层 | Cloudflare Tunnel 自带 HTTPS |
| 认证 | Token 校验，所有 HTTP/WS 请求必带 |
| 限流 | 连续 5 次 token 错误 → 封 IP 10 分钟 |
| Token 轮换 | `claude-remote token rotate` 重新生成 |
| 会话过期 | Web 端 token 7 天有效，过期需重新输入 |

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
    └─ 任意一个客户端响应 → Hub 执行/拒绝 → 广播结果
```

可选增强：Web 端注册 Service Worker，权限请求到来时发 Push Notification，手机锁屏也能收到。

## 11. 新增文件结构

```
src/
├── entrypoints/
│   └── serve.ts                 # Hub 服务入口（新增）
├── hub/                         # Hub 核心（新增）
│   ├── Hub.ts                   # Hub 主类，管理 session 生命周期
│   ├── SessionManager.ts        # Session CRUD + 状态管理
│   ├── EventBus.ts              # 事件广播系统
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
│       ├── token.ts             # Token 生成/验证
│       └── middleware.ts        # 认证中间件
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

# Claude Remote - 任务拆分与认领指南

> 基于 [设计规格](./2026-04-01-claude-remote-design.md)，将实现拆分为可独立认领的任务单元。

## 1. 协作机制

### 1.1 任务生命周期

```
[open] → [claimed] → [in-progress] → [in-review] → [merged]
```

### 1.2 GitHub 工作流

**标签体系：**

| 标签 | 含义 |
|---|---|
| `phase:1-foundation` | 第一阶段：核心基础设施 |
| `phase:2-protocol` | 第二阶段：协议与通信 |
| `phase:3-web` | 第三阶段：Web 前端 |
| `phase:4-features` | 第四阶段：扩展功能 |
| `phase:5-hardening` | 第五阶段：加固与优化 |
| `size:S` | 预计 1-2 天 |
| `size:M` | 预计 3-5 天 |
| `size:L` | 预计 1-2 周 |
| `good-first-issue` | 适合新贡献者 |
| `blocked` | 被其他任务阻塞 |
| `needs-design` | 需要进一步设计讨论 |

**认领流程：**

1. 在 Issue 下评论 `/claim` 表示认领
2. 维护者分配 assignee 并改标签为 `claimed`
3. 认领后 7 天内需要提交第一个 commit，否则自动释放
4. 一个人同时最多认领 2 个任务

**PR 规范：**

- 分支命名：`feat/task-{issue-number}-{short-desc}`
- PR 标题：`feat(hub): implement EventBus (#42)`
- PR 描述引用 Issue：`Closes #42`
- 必须有测试覆盖核心逻辑
- 需要至少 1 个 reviewer approve

### 1.3 GitHub Project Board

```
┌─────────┬───────────┬─────────────┬───────────┬──────────┐
│ Backlog │ Ready     │ In Progress │ In Review │ Done     │
├─────────┼───────────┼─────────────┼───────────┼──────────┤
│ #12     │ #8        │ #3 @alice   │ #1 @bob   │ #0       │
│ #13     │ #9        │ #5 @carol   │           │          │
│ #14     │ #10       │             │           │          │
│ ...     │ #11       │             │           │          │
└─────────┴───────────┴─────────────┴───────────┴──────────┘
```

- **Backlog**：已创建但依赖未就绪
- **Ready**：依赖已满足，可以认领
- **In Progress**：已认领，开发中
- **In Review**：PR 已提交，等待 review
- **Done**：已合并

## 2. 任务拆分

### Phase 1: 核心基础设施（无外部依赖，可并行启动）

#### T01: SQLite 持久化层 `size:M`
**对应规格**：3.3 节
**文件**：`src/hub/store/SqliteStore.ts`, `src/hub/store/schema.sql`, `src/hub/store/migrations/`
**交付物**：
- 表创建（sessions, messages, tasks, favorites, tool_executions）
- WAL 模式启用
- CRUD 操作（session/message/task 的增删改查）
- 迁移框架（版本号 + 自动迁移 + 事务回滚）
- tool_executions 状态枚举（running/completed/failed/interrupted/crashed）
- 资源限制检查（max sessions 等）
**测试**：单元测试覆盖所有 CRUD + 迁移 + 边界情况
**无依赖，可立即开始**

#### T02: EventBus 事件系统 `size:M`
**对应规格**：4.1, 4.3 节
**文件**：`src/hub/EventBus.ts`
**交付物**：
- 事件订阅/发布（`Map<sessionId, Set<listener>>`）
- 单调递增 seq 序列号（每 session 独立）
- 持久化事件先写后推（回调 SqliteStore）
- 非持久化事件直接广播
- 背压：队列深度 > 1000 断连
- Hub 全局事件广播（mcp:statusChanged, auth:revoked, shutdown）
**依赖**：T01（SqliteStore 接口，可 mock）
**测试**：并发广播、seq 递增、背压断连

#### T03: Session 生命周期管理 `size:M`
**对应规格**：3.2, 11.1, 11.2 节
**文件**：`src/hub/SessionManager.ts`
**交付物**：
- Session CRUD（create/get/list/archive）
- SessionStatus 状态机（active → idle → archived, interrupted 等全部转换）
- idle 超时转换（`idle_timeout_ms` 配置）
- active writer 分配/释放/接管逻辑（含加锁序列化）
- 崩溃恢复（启动时标记 running tools 为 crashed，session 标记为 interrupted）
- 资源限制（max sessions, 自动归档 idle）
- 优雅关闭（SIGTERM 处理）
**依赖**：T01, T02
**测试**：状态转换、writer 竞争、崩溃恢复

#### T04: Token 认证系统 `size:S`
**对应规格**：10.2, 10.3 节
**文件**：`src/server/auth/token.ts`, `src/server/auth/middleware.ts`
**交付物**：
- 主 Token 生成/持久化/读取（`~/.claude-remote/hub.token`）
- JWT 会话 Token 签发（httpOnly cookie）
- 滑动续期（剩余 < 1 天自动续）
- Bootstrap token（一次性，5 分钟有效）
- WS ticket 机制（一次性，30 秒有效）
- 限流（请求指纹，连续 5 次失败封 10 分钟）
- Token 轮换（rotate 命令）
- CSRF 防护中间件
**无依赖，可立即开始**

#### T05: 配置管理 `size:S` `good-first-issue`
**对应规格**：12 节
**文件**：`src/shared/constants.ts`, 配置加载逻辑
**交付物**：
- `~/.claude-remote/config.toml` 解析
- 配置优先级：CLI 参数 > 环境变量 > 配置文件 > 默认值
- ConfigOptions 类型（可用模型列表等）
- 配置变更验证
**无依赖，可立即开始**

---

### Phase 2: 协议与通信层（依赖 Phase 1 核心）

#### T06: Hono HTTP 服务骨架 `size:S`
**对应规格**：6 节
**文件**：`src/server/index.ts`, `src/server/routes/*.ts`
**交付物**：
- Hono app 创建 + 认证中间件集成
- 路由注册（sessions, files, skills, config, mcp, health, auth, history, ws-ticket）
- 每个路由的请求/响应类型标注
- Health 端点返回完整状态
- 静态文件 serve（Web 前端产物）
**依赖**：T04（认证中间件）

#### T07: WebSocket 协议实现 `size:L`
**对应规格**：5.1, 5.2, 5.3 节
**文件**：`src/server/ws/handler.ts`, `src/server/ws/protocol.ts`
**交付物**：
- WS ticket 校验连接
- hello 握手（版本号）
- snapshot 发送
- ClientCommand 路由分发
- HubEvent 广播
- active writer 权限校验（完整权限矩阵）
- cmdId 请求-响应关联
- 心跳 / keep-alive
- Unix Socket 支持（TUI 本地连接）
**依赖**：T02, T03, T04, T06
**这是最核心的胶水层，建议资深贡献者认领**

#### T08: 共享类型定义 `size:S` `good-first-issue`
**对应规格**：4.2 节, `src/shared/`
**文件**：`src/shared/types.ts`, `src/shared/protocol.ts`, `src/shared/constants.ts`
**交付物**：
- 所有 TypeScript 类型定义：Session, SessionMeta, SessionSnapshot, SessionConfig, ConfigOptions, ClientConnection, PermissionRequest, ContextUsage, CostSummary, McpServerInfo, SkillInfo, ExportResult, HistorySearchResult, Task, HubEvent, ClientCommand, HubResponse
- 常量定义（端口、路径、超时值）
**无依赖，可立即开始（但需和 T01-T07 协调接口）**

#### T09: Tool Engine 封装 `size:L`
**对应规格**：2.4 节
**文件**：`src/hub/ToolEngine.ts`
**交付物**：
- 包装现有 tools/*，在 Hub 进程中执行
- CWD 隔离（`runWithCwdOverride`）
- AppState 隔离（每 session 独立实例）
- 并发控制（同 session 串行，跨 session 并行，全局上限 5）
- BashTool 子进程 process group 管理
- tool_executions 状态跟踪
**依赖**：T01, T03
**需要深入理解现有 tool 系统**

#### T10: Claude API Client 封装 `size:M`
**对应规格**：Hub.ts, ClaudeClient.ts
**文件**：`src/hub/ClaudeClient.ts`
**交付物**：
- 包装现有 API client，绑定到 session
- 流式响应转为 SDK 事件 → EventBus 广播
- 上下文管理（token 计数、compact 触发）
- 费用追踪
- 中断支持（chat:abort → API cancel）
**依赖**：T02, T03, T09

---

### Phase 3: Web 前端（可与 Phase 2 后期并行）

#### T11: Web 项目骨架 `size:S`
**文件**：`src/web/`
**交付物**：
- React 19 + TypeScript + Tailwind CSS + React Router 配置
- Bun 构建配置
- Zustand store 骨架
- WebSocket hook（`useWebSocket.ts`）+ 自动重连
- 路由结构（/login, /sessions, /chat/:id, /files/:id）
**无依赖（可用 mock 数据开发）**

#### T12: 登录页 `size:S` `good-first-issue`
**文件**：`src/web/pages/Login.tsx`
**交付物**：
- Token 输入表单
- Bootstrap token 自动认证（URL 参数 → httpOnly cookie）
- `history.replaceState` 清除 URL token
- 错误提示
**依赖**：T11

#### T13: Session 列表页 `size:S`
**文件**：`src/web/pages/Sessions.tsx`, `src/web/components/SessionSwitcher.tsx`
**交付物**：
- Session 列表（名称、状态徽标、cwd、时间）
- 创建新 session
- 归档 session
- Session 标签显示
- interrupted session 的"继续/归档"操作
**依赖**：T11

#### T14: 主聊天页 - 消息流 `size:L`
**文件**：`src/web/pages/Chat.tsx`, `src/web/components/MessageList.tsx`, `src/web/components/StreamingText.tsx`
**交付物**：
- 消息列表渲染（用户消息 + AI 消息）
- 流式文字渲染（SDK streaming delta）
- Markdown 渲染
- 自动滚动到底部
- 消息输入框 + 发送
- 上拉加载历史消息
**依赖**：T11
**这是 Web 端最核心的页面**

#### T15: 工具调用卡片 `size:M`
**文件**：`src/web/components/ToolCard.tsx`
**交付物**：
- 可折叠的工具调用结果卡片
- Bash 输出渲染（终端样式）
- 代码高亮（Shiki）
- Diff 高亮（文件编辑结果）
- 加载中状态（tool 执行中）
**依赖**：T14

#### T16: 权限审批 UI `size:S`
**文件**：`src/web/components/PermissionBanner.tsx`
**交付物**：
- 权限请求卡片（工具名、参数、批准/拒绝按钮）
- active writer 专属操作
- standby 客户端只显示通知
- 权限降级场景处理
**依赖**：T14

#### T17: 文件浏览器 `size:M`
**文件**：`src/web/pages/Files.tsx`, `src/web/components/FileViewer.tsx`, `src/web/components/CwdPicker.tsx`
**交付物**：
- 树状目录浏览
- 文件内容预览（语法高亮）
- CWD 切换（收藏目录 + 浏览）
- 大文件分页加载
- 搜索过滤
**依赖**：T11

#### T18: 斜杠命令面板 `size:M`
**文件**：`src/web/components/SkillPalette.tsx`
**交付物**：
- `/` 触发弹出
- Fuse.js 模糊搜索
- skill 描述 + 参数提示
- 选中后自动填入输入框或直接执行
**依赖**：T14

---

### Phase 4: 扩展功能（Phase 2+3 核心完成后）

#### T19: 模型/配置管理 UI `size:S`
**文件**：`src/web/components/ModelSelector.tsx`, `src/web/components/SettingsDrawer.tsx`
**交付物**：
- ModelSelector（模型列表 + effort 级别）
- SettingsDrawer（配置 tab：模型、权限模式）
- config:set 集成
**依赖**：T14

#### T20: 上下文/费用监控 `size:S`
**文件**：`src/web/components/ContextIndicator.tsx`, `src/web/components/CostBadge.tsx`, `src/web/components/CompactPrompt.tsx`
**交付物**：
- 状态条（模型名 + 上下文百分比 + 费用）
- 上下文详情弹窗（token 分布柱状图）
- 费用详情弹窗
- 上下文 > 80% 时 compact 提示
**依赖**：T14

#### T21: MCP 管理面板 `size:M`
**文件**：`src/web/components/McpPanel.tsx`
**交付物**：
- MCP 服务列表（名称、状态、tool 数量）
- 启用/禁用开关
- 重连按钮
- 实时状态更新
**依赖**：T14, T19（SettingsDrawer）

#### T22: 对话分支与导出 `size:M`
**文件**：`src/web/components/BranchMenu.tsx`, `src/web/components/ExportDialog.tsx`
**交付物**：
- 消息长按/右键 → "从这里分支"
- 导出弹窗（Markdown/JSON + 下载/复制）
- chat:compact 触发
- chat:clear + 二次确认
**依赖**：T14

#### T23: 通知中心 `size:S`
**文件**：`src/web/components/NotificationCenter.tsx`
**交付物**：
- 顶栏铃铛图标 + 未读计数
- 下拉通知列表
- 通知类型：权限请求、上下文预警、MCP 异常、writer 变更、Hub 关闭
**依赖**：T14

#### T24: 历史搜索 `size:S`
**文件**：`src/web/components/HistorySearch.tsx`
**交付物**：
- 全文搜索（scope: session/all）
- 结果列表（snippet + 时间 + session 名）
- 点击跳转到对应消息
**依赖**：T13, T14

#### T25: Cloudflare Tunnel 集成 `size:M`
**对应规格**：10.1 节
**文件**：`src/tunnel/cloudflared.ts`
**交付物**：
- 检测 cloudflared 安装
- Quick Tunnel 启动/URL 解析
- 命名 Tunnel 支持
- Bootstrap token 生成 + QR Code 终端打印
- Tunnel 进程管理（启动/关闭）
**无前端依赖，可独立开发**

#### T26: Hub serve 入口 + CLI 命令 `size:M`
**文件**：`src/entrypoints/serve.ts`
**交付物**：
- `claude-remote serve` — 启动 Hub
- `claude-remote attach` — 连接 Hub（含自动启动）
- `claude-remote stop` — 优雅关闭
- `claude-remote status` — 查看状态
- `claude-remote token rotate` — 轮换 token
- `claude-remote logs` — 查看日志
**依赖**：T03, T06, T07, T25

#### T27: TUI 客户端改造 `size:L`
**对应规格**：7 节
**交付物**：
- 现有 REPL 改为 WebSocket 客户端模式
- 本地状态镜像（snapshot + 增量事件）
- 权限请求转发
- Hub 不可用时的降级独立模式
- Unix Socket 连接
**依赖**：T07, T09, T10
**这是改动量最大的任务，建议对现有代码最熟悉的人认领**

---

### Phase 5: 加固与优化

#### T28: Plan 模式查看器 `size:S`
#### T29: Service Worker Push Notification `size:S`
#### T30: 日志与可观测性 `size:S`
#### T31: E2E 测试 `size:L`
#### T32: 性能优化（大对话渲染、虚拟滚动） `size:M`
#### T33: 移动端 UX 打磨（手势、触控优化） `size:M`

---

## 3. 依赖关系图

```
Phase 1 (可全部并行启动)
├── T01 SQLite Store
├── T02 EventBus ←── T01
├── T03 SessionManager ←── T01, T02
├── T04 Token Auth
├── T05 Config ─────────────────────────────────────────┐
│                                                        │
Phase 2                                                  │
├── T06 HTTP Server ←── T04                              │
├── T07 WebSocket Protocol ←── T02, T03, T04, T06  ◀── 关键路径
├── T08 Shared Types（可提前开始，持续更新）               │
├── T09 Tool Engine ←── T01, T03                         │
├── T10 Claude Client ←── T02, T03, T09                  │
│                                                        │
Phase 3 (T11 可提前启动，用 mock 数据)                     │
├── T11 Web 骨架                                          │
├── T12 Login ←── T11                                    │
├── T13 Sessions ←── T11                                 │
├── T14 Chat 主页 ←── T11  ◀── Web 端关键路径             │
├── T15 ToolCard ←── T14                                 │
├── T16 Permission ←── T14                               │
├── T17 File Browser ←── T11                             │
├── T18 SkillPalette ←── T14                             │
│                                                        │
Phase 4 (Phase 2+3 核心完成后)                             │
├── T19-T24 扩展 UI ←── T14                              │
├── T25 Tunnel（可独立开发）                               │
├── T26 CLI 入口 ←── T03, T06, T07, T25                  │
├── T27 TUI 改造 ←── T07, T09, T10  ◀── 最大改动量        │
│                                                        │
Phase 5                                                  │
└── T28-T33 加固 ←── all above                           │
```

## 4. 关键路径

最短可演示路径（MVP）：

```
T01 + T04 + T05 → T02 → T03 → T06 → T07 → T08
                                              ↓
T11 → T14 → T15 + T16                   全栈联调
```

**MVP 目标**：能在手机浏览器上完成一次完整的对话，包括发送消息、查看流式响应、批准工具权限。

预计 MVP 需要 8 个任务（T01-T08 + T11 + T14-T16），约 4-5 人并行 3-4 周可完成。

## 5. 快速上手

### 新贡献者推荐任务

| 任务 | 难度 | 说明 |
|---|---|---|
| T05 配置管理 | 低 | 纯 TypeScript，无需理解现有代码 |
| T08 共享类型定义 | 低 | 照着 spec 写类型，是了解项目的好入口 |
| T12 登录页 | 低 | 简单 React 页面 |
| T04 Token 认证 | 中 | 独立模块，涉及 JWT + cookie |

### 需要深入理解现有代码的任务

| 任务 | 说明 |
|---|---|
| T09 Tool Engine | 需要熟悉现有 tools/* 和 AppState |
| T10 Claude Client | 需要熟悉现有 API client 和 SDK 消息格式 |
| T27 TUI 改造 | 需要熟悉现有 Ink 组件和 REPL 流程 |

### 适合前端工程师的任务

T11-T24（Phase 3+4 全部）：纯 React + TypeScript，可用 mock WebSocket 独立开发。

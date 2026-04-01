# Local Hub Baseline + Contributor Onramp - Design Spec

> 为 Claude Remote 建立首个可并行开发的本地 Hub 基线，并让贡献者可以直接按 Issue 认领任务、提交 Draft PR。

## 1. 背景

### 1.1 为什么要做 Claude Remote

Claude Code 这类 AI 开发工具的真正价值不在聊天框，而在它运行时所依附的真实开发环境：

- 本地工作目录
- 本地 shell / git / 凭据
- 本地工具链与项目配置
- 本地 MCP 与脚本环境

如果所谓 remote 只是“从网页远程发一条消息”，那只是把交互入口搬到了远端，并没有把真实开发会话 remote 出去。

Claude Remote 的目标是把 **运行在开发机上的 AI 开发会话** 变成可 attach 的常驻服务：

- AI 会话驻留在开发机
- 客户端断开后，会话仍然存在
- TUI 和 Web attach 的是同一个 session
- 远程操作的仍是本地开发环境，而不是另一个替代环境

它也服务一个非常现实的场景：

- 开发机或中转机位于海外，网络与权限环境更适合访问国外模型服务
- 开发者本人在国内，通过手机、终端或未来的桌面客户端 attach 到远端开发机会话
- 最终体验应尽可能接近“我就坐在那台机器前面本地开发”

### 1.2 相对官方 remote 方案的定位差异

本项目不把“remote”定义为远程访问一个 prompt 输入框，而把它定义为：

> 远程访问开发机上正在运行的 AI 开发会话。

按这个定义，我们追求的核心能力是：

1. **会话常驻**：引擎与状态不依赖某个前端页面是否打开
2. **多端 attach**：手机、终端可以连接同一个 session
3. **环境真实**：继续使用开发机上的目录、git、shell、工具和配置
4. **状态共享**：一个 session 只有一个真实状态，而不是多个平行副本
5. **跨地域可用**：开发者不必坐在远端机器前，也不必复制一套开发环境到本地

因此，Claude Remote 的价值主张不是“多一个 UI”，而是“让 Claude Code 变成真正的远程开发服务”。

### 1.2.1 作为国内开发者使用海外开发机的方案

这个项目还有一个明确定位：

> 它可以成为国内开发者使用海外开发机、海外网络出口和海外模型服务的统一远程开发入口。

在这个模式下，Claude Remote 提供的不是单纯代理请求，而是：

- 把会话、工具执行、目录状态都留在远端机器
- 让本地用户只负责 attach 和交互
- 尽量保留“像本地开发一样”的连续体验

这也是为什么项目要优先强调 session 常驻、attach、多端同步，而不是先做一个新的网页聊天壳。

### 1.3 为什么先做本地 Hub 基线

完整的 Claude Remote 规格覆盖 Hub、协议、TUI、Web、权限、持久化、Tunnel、安全等多个子系统。直接实现完整方案会让首轮开发过大，且不利于多人并行。

第一阶段应优先解决两个问题：

1. **代码底座**：建立 `serve` / `attach` / snapshot-event 协议 / 本地 Unix Socket 通信
2. **协作底座**：让其他开发者可以按规则认领 Issue、开分支、提 Draft PR

只有这两个底座先稳住，后续聊天链路、Web 前端、持久化和权限流才能拆给不同贡献者并行开发。

## 2. 本子项目的目标

本子项目定义为：

> **Local Hub Baseline + Contributor Onramp**

它是 Claude Remote 的第一个可交付里程碑，目标是让开发者能够在本地启动最小 Hub、从 TUI attach 进去，并基于清晰的贡献流程继续迭代。

### 2.1 In Scope

- 新增 `serve` / `attach` / `status` 子命令
- 本地 Hub 常驻进程
- Unix Socket 通信
- 最小 session 生命周期
- snapshot / event / reply / error 协议骨架
- TUI attach 到 Hub 的最小接入
- `chat` 命令返回结构化 `not_implemented`
- `README.md` 补充产品定位与设计稿展示
- `CONTRIBUTING.md` 补充认领、分支、PR、Project Board 流程

### 2.2 Out of Scope

- 真实 Claude API 聊天执行
- Tool Engine 接入 Hub
- Web 前端实现
- Desktop client 实现
- SQLite 持久化
- Cloudflare Tunnel
- Token / Session 认证
- 多 session 高级切换与 writer 抢占全量实现
- 权限审批完整闭环

## 3. 用户与开发者价值

### 3.1 对最终产品的价值

即使此阶段不实现真实聊天，它仍然定义了 Claude Remote 最关键的运行模型：

- `serve` 负责会话常驻
- `attach` 负责客户端接入
- session 状态在 Hub 中，而不是在 TUI 中
- 后续 Web / Desktop 都 attach 到同一个 Hub，而不是各自维护一套状态

这为后续所有功能提供统一落点。

### 3.2 对贡献者的价值

本阶段完成后，其他开发者可以直接基于以下稳定边界继续开发：

- `HubProtocol`：接 Web、session list、chat、event 同步
- `SessionRegistry`：接多 session、持久化、writer ownership
- `HubClient`：接 TUI、未来 Web client 与未来 Desktop client
- `CONTRIBUTING.md`：按 Issue `/claim` 认领任务并提交 Draft PR

## 4. 命令与运行模型

### 4.1 CLI 策略

当前仓库仍以现有 CLI 二进制为基础，因此本阶段 **不做全量二进制重命名**。先在现有命令面上增加 Claude Remote 所需子命令：

```bash
claude-remote serve
claude-remote attach
claude-remote status
```

README 中可以使用产品名 `Claude Remote` 进行说明，但实现上继续复用现有 CLI 入口，避免首阶段把工作扩散到安装、发布、bin 名称和兼容层。

### 4.2 `serve`

`serve` 启动一个本地 Hub 进程，负责：

- 创建 Unix Socket：`~/.claude-remote/hub.sock`
- 维护最小 SessionRegistry
- 接收 attach 连接
- 提供最小请求响应协议
- 提供 Hub 状态查询

本阶段 Hub 只驻留在本机，不对外暴露 HTTP 或 WebSocket 服务。

### 4.3 `attach`

`attach` 连接本地 Hub：

- 如果 Hub 已存在，则直接连接
- 如果 Hub 不存在，则自动拉起 `serve`
- 连接成功后获取 `snapshot`
- 开始监听 `event`
- 在 TUI 中显示当前由 Hub 驱动

### 4.4 `status`

`status` 用于帮助开发者确认本地基线是否正常：

- Hub 是否运行
- Unix Socket 是否存在
- 当前 session 数
- 当前连接数

它是 Phase 1 的开发辅助命令，不追求最终产品形态。

## 5. 最小 Hub 架构

### 5.1 新增目录

```text
src/
├── hub/
│   ├── Hub.ts
│   ├── SessionRegistry.ts
│   ├── LocalSocketServer.ts
│   ├── HubProtocol.ts
│   └── client/
│       ├── HubClient.ts
│       └── HubConnectionState.ts
```

### 5.2 组件职责

#### `Hub.ts`

负责：

- Hub 生命周期
- 启停 Unix Socket server
- 组装 SessionRegistry
- 处理进程关闭

#### `SessionRegistry.ts`

负责：

- 创建最小 session
- 保存内存中的 session 列表
- 维护 session 的客户端连接信息
- 返回 `snapshot`

本阶段 session 只在内存中保存。

#### `LocalSocketServer.ts`

负责：

- 接受本地 Unix Socket 客户端连接
- 读取命令
- 发送 `reply` / `error` / `event`

#### `HubProtocol.ts`

负责共享协议定义：

- `ClientCommand`
- `HubResponse`
- `Snapshot`
- `HubEvent`

#### `HubClient.ts`

负责：

- attach 到本地 Hub
- 发送命令
- 订阅事件
- 管理连接状态

## 6. 最小协议

### 6.1 Snapshot

连接建立后，Hub 立即返回最小 snapshot：

```ts
type Snapshot = {
  session: Session
  connectionState: 'connected'
}
```

### 6.2 Commands

本阶段只实现最小命令集：

```ts
type ClientCommand =
  | { cmdId: string; cmd: 'session:create'; cwd: string; name?: string }
  | { cmdId: string; cmd: 'session:list' }
  | { cmdId: string; cmd: 'session:attach'; sessionId: string }
  | { cmdId: string; cmd: 'chat'; text: string }
  | { cmdId: string; cmd: 'hub:status' }
```

### 6.3 Responses

```ts
type HubResponse =
  | { type: 'snapshot'; session: Session }
  | { type: 'event'; event: HubEvent }
  | { type: 'reply'; cmdId: string; data: unknown }
  | { type: 'error'; cmdId: string; error: string; code?: string }
```

### 6.4 Event 范围

本阶段事件只覆盖最小生命周期，不引入流式消息或工具事件：

```ts
type HubEvent =
  | { type: 'session:created'; session: Session }
  | { type: 'session:attached'; sessionId: string; clientId: string }
  | { type: 'session:updated'; session: Session }
  | { type: 'hub:shutdown' }
```

### 6.5 `chat` 的行为

`chat` 命令必须保留在协议里，但本阶段不实现真实执行。Hub 返回结构化错误：

```ts
{
  type: 'error',
  cmdId: '...',
  code: 'not_implemented',
  error: 'chat is not implemented in Local Hub Baseline'
}
```

这样后续贡献者可以直接在这个协议点上继续实现聊天链路，而无需再改动命令面。

## 7. TUI 接入策略

### 7.1 本阶段目标

TUI 不重写为全量 Hub 客户端，只做最小接入：

- attach Hub
- 接收 snapshot
- 显示当前 connection state
- 发送最小命令
- 对 `not_implemented` 给出明确提示

### 7.2 UI 行为

本阶段 TUI 的用户体验要求很简单：

- attach 成功时显示系统提示：已连接本地 Hub
- session 不存在时自动创建默认 session
- 用户输入普通聊天内容时，不静默失败，而是看到“Hub 基线已连接，但 chat 尚未实现”

## 8. Session 模型

本阶段使用最小 Session：

```ts
type SessionStatus = 'active' | 'idle'

type Session = {
  id: string
  name: string
  cwd: string
  createdAt: number
  updatedAt: number
  status: SessionStatus
  clients: Array<{
    id: string
    type: 'tui'
    connectedAt: number
  }>
  messages: []
  tasks: []
}
```

理由：

- 这一轮没有持久化、writer ownership、Web client，因此无需引入完整状态机
- 只保留后续可自然扩展的字段，避免做完还得删

## 9. README 与设计稿落地

### 9.1 README 必须回答的问题

README 不只介绍“要做什么”，还必须明确说明：

1. 为什么要做 Claude Remote
2. 它和“只把入口搬到网页的 remote”有什么本质不同
3. 当前仓库处于哪个阶段
4. 贡献者如何开始开发

### 9.2 README 更新内容

README 至少要包含以下新增内容：

- “Why Remote” 一节
- “Why This Is Real Remote” 一节
- “Why This Works Well For Domestic Developers Using Overseas Dev Machines” 一节
- 当前阶段说明：当前只完成 Local Hub Baseline 目标
- Stitch 项目链接：
  - [Claude Remote - Mobile Web UI](https://stitch.withgoogle.com/projects/9350772801597042)
- 设计稿展示区

### 9.3 设计稿图片策略

Stitch 中的关键 screen 需要导出为仓库内静态图片，并纳入版本库。README 不直接依赖第三方在线截图链接。

建议路径：

```text
docs/designs/claude-remote/
```

README 中展示所有主要 screen，包括至少：

- Login
- Sessions List
- Main Chat
- File Browser
- File Preview

如果同一类 screen 有多个版本，可以全部展示，但需标注名称，避免 README 中图片语义不清。

### 9.4 Desktop 方向的 README 表达

README 需要明确传达一个长期方向：

- Claude Remote 不只服务手机 Web
- 它最终也可以承载桌面客户端
- 无论是 TUI、Web 还是未来 Desktop，本质上都应 attach 到同一个 Hub

但 README 必须同时说明：**Desktop client 是后续阶段，不属于 Local Hub Baseline 的实现范围。**

## 10. 贡献者工作流

### 10.1 认领方式

贡献者通过 GitHub Issue 评论 `/claim` 认领任务。

本阶段不做自动化 Bot，先使用轻量约定：

- 先评论 `/claim` 者优先
- 若 24 小时内无实际进展，可由维护者释放认领状态

### 10.2 分支规则

每条 Issue 一个分支：

```text
codex/issue-<编号>-<slug>
```

例如：

```text
codex/issue-12-local-hub-protocol
```

### 10.3 PR 规则

- 一条 Issue 一个 PR
- 默认创建 Draft PR
- PR 描述中必须引用对应 Issue

### 10.4 Project Board 规则

Project Board 至少使用以下列：

- `Todo`
- `In Progress`
- `In Review`
- `Done`

状态流转规则：

- 认领后进入 `In Progress`
- 创建 Draft PR 后进入 `In Review`
- 合并后进入 `Done`

### 10.5 仓库文档

本阶段新增 `CONTRIBUTING.md`，写清：

- `/claim` 认领方式
- 分支命名
- Draft PR 规则
- Project Board 使用方式
- 开发前需要先读的大规格文档与当前子规格文档

## 11. 验收标准

本阶段完成后，至少满足：

1. `claude-remote serve` 可启动本地 Hub
2. Hub 能监听 Unix Socket
3. `claude-remote attach` 可连接 Hub
4. attach 成功后能收到 `snapshot`
5. 最小 session 创建/列出/attach 可用
6. `chat` 返回结构化 `not_implemented`
7. `claude-remote status` 可显示 Hub 当前状态
8. `README.md` 已补充 remote 价值主张与全部关键设计稿
9. `CONTRIBUTING.md` 已让新贡献者可直接按 Issue 开发

## 12. 测试策略

### 12.1 单元测试

覆盖：

- SessionRegistry 的 session 创建与查询
- HubProtocol 的消息编解码
- HubClient 的连接状态转换

### 12.2 集成测试

覆盖：

- 启动 `serve`
- `attach` 成功连接
- 自动创建默认 session
- `chat` 返回 `not_implemented`
- `status` 返回 Hub 元数据

### 12.3 文档验证

人工检查：

- README 中的设计稿图片路径有效
- Stitch 链接正确
- CONTRIBUTING 流程与 GitHub 当前实际做法一致

## 13. 风险与取舍

### 13.1 为什么本阶段不做 SQLite

因为 SQLite 会把首轮工作扩展到 schema、恢复、兼容与状态语义，不利于尽快形成多人开发骨架。

### 13.2 为什么 `chat` 要保留但不实现

如果现在直接删掉 `chat`，下一阶段还要改协议；保留它但返回明确错误，能让协议面先稳定下来。

### 13.3 为什么 README 要现在就更新

这个项目当前不是单人自用脚本，而是准备让别人进来开发。README 是外部协作入口，不能等到“功能做完再补”。

## 14. 下一步

该子规格通过后，进入 implementation plan 阶段，拆出可独立认领的任务，例如：

- Hub 进程骨架
- Unix Socket server/client
- SessionRegistry
- attach 命令接入
- status 命令
- README 设计稿导出与整理
- CONTRIBUTING.md

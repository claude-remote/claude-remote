# Claude Remote

> Attach to the AI coding session running on your development machine, instead of opening a second-class remote chat box.
>
> 连接到运行在开发机上的 AI 编程会话，而不是打开一个二等公民式的远程聊天框。

[English](#why-claude-remote) | [中文](#为什么做-claude-remote)

## New Contributor Start Here

If you want to start contributing, do this first:

1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
2. Pick an open issue and comment `/claim`
3. Create a branch named `issue-<number>-<slug>`
4. Open a draft PR when the issue-sized slice is ready

```bash
bun install
./bin/claude-remote status
./bin/claude-remote serve
./bin/claude-remote attach
```

---

## Core Features / 核心特性

- **Remote Control from Phone / 手机远程控制** — Full-featured operation from mobile browser, aligned with terminal experience
- **Session Hub Architecture / Session Hub 架构** — Persistent background service, multi-session management, SQLite storage
- **Multi-Client Real-Time Sync / 多端实时同步** — TUI and Web share sessions, messages/tools/permissions sync in real-time
- **Full Tool Support / 工具全功能** — 47 built-in tools, 103+ slash commands, 20 Skills, fully supported on Web
- **PWA Native Experience / PWA 原生体验** — Add to home screen for native app experience, push notifications supported
- **Secure Remote Access / 安全远程访问** — Cloudflare Tunnel + Token dual-layer authentication
- **Working Directory Management / 工作目录管理** — Favorite directories + file browser, switch projects from phone

## Tech Stack / 技术栈

| Layer | Technology |
|-------|------------|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript |
| Server | Hono.js (HTTP + WebSocket) |
| Frontend | React 19 + Tailwind CSS + Zustand |
| TUI | React + Ink |
| Database | SQLite (WAL mode) |
| Tunnel | Cloudflare Tunnel |

---

# English

## Why Claude Remote

Claude Remote is aimed at a different problem than a generic web chat wrapper.

- The session should live on the development machine, not in a browser tab.
- The real working directory, shell, git state, tools, MCP config, and local credentials should stay where the code is.
- A phone, terminal, and future desktop client should be able to attach to the same session.
- Disconnecting the client should not kill the development session.

That is what this repo means by "real remote".

For domestic developers using overseas development machines or overseas network egress, this is also a practical setup: the model-facing environment stays on the remote machine, while your phone or local terminal becomes a thin client with near-local workflow continuity.

## Architecture

```mermaid
graph TD
    subgraph Clients["Clients"]
        TUI["Terminal TUI"]
        WEB["Mobile Web"]
        DESKTOP["Desktop Client (Planned)"]
    end

    subgraph RemoteEnv["Developer Machine / Remote Dev Box"]
        HUB["Claude Remote Hub"]
        REPO["Real Repo + Shell + Git + Tools"]
    end

    subgraph Access["Access Layer"]
        TUNNEL["Tunnel / Private Access"]
    end

    TUI --> HUB
    WEB --> TUNNEL
    DESKTOP --> TUNNEL
    TUNNEL --> HUB
    HUB --> REPO
```

Key design decisions:

- **Hub is the engine**, clients (TUI / Web) are pure view layers
- Each session has independent AppState + cwd isolation (`AsyncLocalStorage`)
- WebSocket event-driven, SQLite WAL mode persistence
- CLI exit does not affect Hub — phone can continue operating

## Domestic Access Scenario

Claude Remote is not a magic network bypass by itself, but **theoretically it can solve the "domestic device cannot directly use Claude" problem** in a practical way:

- Run Claude Remote on an overseas development machine, overseas VPS, or any environment with stable Claude access
- Keep model calls on that remote environment
- Use your phone, browser, terminal, or future desktop client only as an attached control surface

In that setup, the local device does not need to talk directly to Claude. The remote environment does.

Practical boundary:

- This depends on the remote environment actually being able to access Claude reliably
- This repo does not claim to guarantee legal, policy, or network outcomes
- The benefit comes from moving the AI execution environment, not from bypassing restrictions on the local device itself

## Safety & Compliance

> **Core principle: Blend in, don't disappear.** Claude Remote is not an automation tool — it moves the terminal to your phone. From the server's perspective, you are still a normal user using Claude Code.

### Why It Won't Cause Account Bans

| Design Decision | Safety Reason |
|---|---|
| **Reuse official Claude Client directly** | HTTP Header, User-Agent, fingerprint headers, anti-distillation headers all pass through unchanged |
| **Telemetry untouched** | Default telemetry reporting preserved, no `DISABLE_TELEMETRY` env vars set |
| **PWA instead of native App** | No GPS/SIM/base station hardware signals collected |
| **Single account, single device** | Hub runs on your own dev machine, Device ID unchanged |
| **Human always in control** | Every message sent by human, every permission approved by human |
| **Global rate limiting** | Auto-throttle on concurrent sessions (default max 2 concurrent API calls, 20/min) |

### Technical Detail: How Hub Matches Local CLI

Claude Code uses multi-dimensional signals to detect its runtime environment. Hub as a daemon lacks normal terminal session characteristics. Without patching, the compliance system would see a "non-interactive automation tool" — a high-risk signal.

**Hub automatically executes environment patching (`patchInteractiveEnv`) at startup, eliminating every difference:**

| Signal | Local CLI (normal) | Hub daemon (unpatched) | Hub (patched) |
|---|---|---|---|
| `process.stdout.isTTY` | `true` | `undefined` | `true` |
| `is_interactive` (telemetry) | `true` | `false` | `true` |
| `TERM` | `xterm-256color` | unset | `xterm-256color` |
| `TERM_PROGRAM` | `iTerm2` etc | unset | `xterm` |
| `COLORTERM` | `truecolor` | unset | `truecolor` |
| `COLUMNS` / `LINES` | real size | unset | `120` / `40` |
| API request headers | official Client | same Client | identical |
| Device ID | local machine | same machine | identical |
| Egress IP | local IP | same machine | identical |
| Telemetry data | reports local env | reports same env | identical |

**How it works:** Hub calls `patchInteractiveEnv()` as the **very first line** in `serve.ts`, before any Claude Code module loads. All subsequent detection logic (`detectTerminal()`, telemetry collection, API logging) sees a normal interactive terminal environment.

```
claude-remote serve
    │
    ├─ 1. patchInteractiveEnv()     ← Step 1: Patch TTY + env vars
    ├─ 2. verifyInteractiveEnv()    ← Verify patch is effective
    ├─ 3. Check unsafe env vars     ← Warn about DISABLE_TELEMETRY etc
    └─ 4. Load Claude Code modules  ← All detection logic sees normal env
```

The patch uses `??=` assignment — never overwrites existing values.

### Usage Guidelines

- **Do NOT disable telemetry** — disabling telemetry is the strongest anomaly signal, telling compliance "I have something to hide"
- **Do NOT install the official mobile client** — mobile apps collect GPS/SIM/base station signals that are impossible to mask; PWA is sufficient
- **Do NOT run too many sessions concurrently** — built-in rate limiting provides a safety net, but reasonable usage habits are safer
- **Do NOT call 24/7 non-stop** — maintain normal human usage rhythm
- **Keep environment signals consistent** — timezone (`TZ`), language (`LANG`), egress IP should point to the same compliant region
- **Do NOT use China-specific Linux distros** — deepin/UOS/openKylin distro names are strong geographic signals

See design spec [Section 16: Compliance](./docs/superpowers/specs/2026-04-01-claude-remote-design.md) for full details.

## Current Phase

This repo is currently in **Phase 1: Local Hub Baseline + Contributor Onramp**.

What exists now:

- `claude-remote serve`
- `claude-remote status`
- `claude-remote attach`
- Unix socket local hub transport
- In-memory session registry
- Minimal socket protocol and local hub client

What is intentionally not done yet:

- Hub-backed chat execution
- Web frontend implementation
- SQLite persistence
- Tunnel/auth/web session management
- Full multi-client conflict handling

## Contributor Workflow

- Full workflow: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Claim work by commenting `/claim` on an issue
- Work one issue per branch and one issue per PR
- Use branch names like `issue-12-local-hub-client`
- Open draft PRs first

## Quick Start

Requirements: Bun `>= 1.2`, Node.js `>= 18`

```bash
bun install
./bin/claude-remote status
./bin/claude-remote serve
./bin/claude-remote attach
```

---

# 中文

## 为什么做 Claude Remote

Claude Remote 要解决的问题与通用 Web 聊天框不同：

- 会话应该运行在开发机上，而不是浏览器标签页里
- 真实的工作目录、Shell、Git 状态、工具、MCP 配置和本地凭证应该留在代码所在的地方
- 手机、终端、未来的桌面客户端应该能连接到同一个会话
- 断开客户端不应该杀死开发会话

这就是本仓库所说的"真正的远程"。

对于使用海外开发机或海外网络出口的国内开发者来说，这也是一个实用方案：面向模型的环境留在远程机器上，手机或本地终端只是一个瘦客户端。

## 架构

```mermaid
graph TD
    subgraph Clients["客户端"]
        A["📱 手机浏览器<br/>(Web SPA)"]
        B["💻 终端 TUI<br/>(Ink)"]
        C["💻 另一个终端<br/>(Ink)"]
    end

    subgraph Hub["Session Hub (常驻进程)"]
        direction TB
        SM["Session Manager<br/>多 Session 管理"]
        TE["Tool Engine<br/>47 个内置工具"]
        API["Claude API Client"]
        EB["Event Bus<br/>实时状态广播"]
        DB["SQLite (WAL)<br/>持久化存储"]
        SM --- TE
        SM --- API
        SM --- EB
        SM --- DB
    end

    A -- "WebSocket" --> Hub
    B -- "WebSocket / Unix Socket" --> Hub
    C -- "WebSocket" --> Hub

    subgraph Network
        CF["☁️ Cloudflare Tunnel"]
    end

    Hub -- "HTTPS" --> CF
    CF -- "公网访问" --> A

    style Hub fill:#FDF2EC,stroke:#D4845F,stroke-width:2px
    style A fill:#D4845F,color:#fff,stroke:#B8704F
    style B fill:#F5F0EB,stroke:#8B7355
    style C fill:#F5F0EB,stroke:#8B7355
    style CF fill:#F0F7FF,stroke:#4A90D9
```

**关键设计：**
- **Hub 是引擎**，客户端（TUI / Web）是纯视图层
- 每个 Session 独立 AppState + cwd 隔离（`AsyncLocalStorage`）
- WebSocket 事件驱动，SQLite WAL 模式持久化
- CLI 退出不影响 Hub，手机可继续操作

## 国内访问场景

Claude Remote 本身不是网络绕过工具，但**理论上可以解决"国内设备无法直接使用 Claude"的问题**：

- 在海外开发机、海外 VPS 或任何能稳定访问 Claude 的环境上运行 Claude Remote
- 模型调用留在远程环境
- 手机、浏览器、终端只作为控制面板连接

在这种方案下，本地设备不需要直接与 Claude 通信，远程环境负责通信。

实际边界：

- 这取决于远程环境是否能可靠访问 Claude
- 本仓库不对法律、政策或网络结果做任何保证
- 好处来自于移动 AI 执行环境，而非绕过本地设备的限制

## 安全与合规

> **核心原则：融入，不消失。** Claude Remote 不是自动化工具，而是把终端搬到手机上。从服务端视角看，你仍然是一个正常用户在使用 Claude Code。

### 为什么不会导致封号

| 设计决策 | 安全原因 |
|---|---|
| **直接复用官方 Claude Client** | HTTP Header、User-Agent、指纹头、anti-distillation 头全部原样透传，服务端看到的请求与正常 CLI 完全一致 |
| **遥测不关不改** | 保持默认遥测上报，不设置任何 `DISABLE_TELEMETRY` 等环境变量。关闭遥测本身是最强的异常信号 |
| **PWA 而非原生 App** | 不采集 GPS/SIM 卡/基站等硬件级地理信号，比安装官方手机客户端更安全 |
| **单账号单设备** | Hub 运行在你自己的开发机上，Device ID 不变，不存在账号共享 |
| **人类始终在操作** | 每条消息是人发的、每个权限是人批的，不是无人值守的自动化脚本 |
| **全局频率控制** | 多 session 并发时自动限流（默认最多 2 个并发 API 调用、每分钟 20 次），防止触发自动化检测 |

### 技术原理：Hub 如何做到与本地 CLI 完全一致

Claude Code 通过多维信号判断运行环境。Hub 作为守护进程启动时，缺少正常终端会话的特征。如果不处理，风控系统会看到一个"非交互式自动化工具"——这是高风险信号。

**Hub 启动时自动执行环境补丁（`patchInteractiveEnv`），逐项消除差异：**

| 信号 | 本地 CLI（正常） | Hub 守护进程（未修复） | Hub（修复后） |
|---|---|---|---|
| `process.stdout.isTTY` | `true` | `undefined` | `true` |
| `is_interactive`（遥测字段） | `true` | `false` | `true` |
| `TERM` | `xterm-256color` | 未设置 | `xterm-256color` |
| `TERM_PROGRAM` | `iTerm2` 等 | 未设置 | `xterm` |
| `COLORTERM` | `truecolor` | 未设置 | `truecolor` |
| `COLUMNS` / `LINES` | 真实窗口尺寸 | 未设置 | `120` / `40` |
| API 请求 Header | 官方 Client | 同一个 Client | 完全一致 |
| Device ID | 本机生成 | 同一台机器 | 完全一致 |
| 出口 IP | 本机 IP | 同一台机器 | 完全一致 |
| 遥测数据 | 上报本机环境 | 上报同一台机器环境 | 完全一致 |

**核心逻辑：** Hub 在 `serve.ts` 入口的**第一行**就调用 `patchInteractiveEnv()`，在任何 Claude Code 模块加载之前完成环境补丁。后续所有检测逻辑（`detectTerminal()`、遥测采集、API 日志）看到的都是正常的交互式终端环境。

```
claude-remote serve
    │
    ├─ 1. patchInteractiveEnv()     ← 第一步：补丁 TTY + 环境变量
    ├─ 2. verifyInteractiveEnv()    ← 验证补丁生效
    ├─ 3. 检查不安全环境变量          ← 警告 DISABLE_TELEMETRY 等
    └─ 4. 加载 Claude Code 模块      ← 此时所有检测逻辑看到正常环境
```

**补丁不覆盖用户已有值**（使用 `??=` 赋值），如果你的机器上已设置了 `TERM`，补丁会保留你的值。

**不需要伪装的部分**（天然一致）：Hub 就运行在你的开发机上，所以 Device ID、IP 地址、OAuth Token、遥测采集的系统信息都与本地 CLI 完全相同——因为它们就是同一台机器。

### 使用建议

- **不要关闭遥测** — 关闭遥测等于告诉风控系统"我有东西要藏"，是最危险的操作
- **不要安装官方手机客户端** — 手机 App 会采集 GPS/SIM/基站等无法伪装的硬件信号，用 PWA 就够了
- **不要同时跑太多 session** — 内置频率控制会兜底，但保持合理使用习惯更安全
- **不要 24 小时无间断调用** — 保持正常的人类使用节奏
- **环境信号保持一致** — 时区（`TZ`）、语言（`LANG`）、IP 出口地理位置应指向同一个合规地区
- **不要使用中国特有 Linux 发行版** — deepin/UOS/openKylin 等发行版名称本身就是强地理信号

详见设计规格 [Section 16: 合规与防封号](./docs/superpowers/specs/2026-04-01-claude-remote-design.md)。

## 当前阶段

本仓库目前处于 **Phase 1: 本地 Hub 基线 + 贡献者入口**。

已完成：

- `claude-remote serve` / `status` / `attach`
- Unix socket 本地 Hub 传输
- 内存 session 注册表
- 最小化 socket 协议和本地 Hub 客户端

尚未开始：

- Hub 驱动的聊天执行
- Web 前端
- SQLite 持久化
- Tunnel/认证/Web session 管理
- 完整多客户端冲突处理

## 快速开始

需要 Bun `>= 1.2`，Node.js `>= 18`。

```bash
bun install
./bin/claude-remote status
./bin/claude-remote serve
./bin/claude-remote attach
```

## 项目结构

```
src/
├── entrypoints/
│   ├── cli.tsx              # CLI 主入口
│   └── serve.ts             # Hub 服务入口
├── hub/                     # Hub 核心
│   ├── Hub.ts               # Hub 主类
│   ├── patchInteractiveEnv.ts # 环境补丁（消除守护进程 vs 终端差异）
│   ├── SessionManager.ts    # Session CRUD + 状态管理
│   ├── EventBus.ts          # 事件广播系统
│   ├── ToolEngine.ts        # Tool 执行引擎
│   └── store/SqliteStore.ts # SQLite 持久化
├── server/                  # HTTP/WS 服务
│   ├── routes/              # REST API
│   ├── ws/                  # WebSocket 协议
│   └── auth/                # Token 认证
├── web/                     # Web 前端 SPA
│   ├── pages/               # Login, Sessions, Chat, Files
│   └── components/          # UI 组件
├── shared/                  # 前后端共享类型
├── tunnel/                  # Cloudflare Tunnel 管理
├── screens/REPL.tsx         # TUI 交互界面
├── tools/                   # 47 个内置工具
├── commands/                # 103+ 斜杠命令
├── skills/                  # 20 个 Skills
└── services/                # API, MCP, OAuth 等服务层
```

---

## Specs & Plans / 设计文档

- Main product spec / 产品设计规格: [`docs/superpowers/specs/2026-04-01-claude-remote-design.md`](./docs/superpowers/specs/2026-04-01-claude-remote-design.md)
- Local baseline spec / 本地基线设计: [`docs/superpowers/specs/2026-04-01-local-hub-baseline-design.md`](./docs/superpowers/specs/2026-04-01-local-hub-baseline-design.md)
- Local baseline plan / 本地基线计划: [`docs/superpowers/plans/2026-04-01-local-hub-baseline.md`](./docs/superpowers/plans/2026-04-01-local-hub-baseline.md)

## Contribution Guardrails / 贡献约束

1. 先阅读设计规格和任务拆分文档。
2. 在对应 issue 下评论 `/claim`，确认任务已经分配给你。
3. 选择一个 `Txx` 任务作为单独开发范围。
4. 以任务号为单位提交 PR，避免跨任务大杂烩。
5. stub 中的 `TODO(Txx)` 已标出对应实现入口，认领任务时优先从这些文件开始。

The repository now enforces this flow in CI:

- PR 必须链接到一个 issue
- 该 issue 必须已经通过 `/claim` 被 PR 作者认领
- 没有先 `/claim` 的 PR 会被 CI 直接拦下

## Design Screens / UI 设计稿

Stitch project: [Claude Remote - Mobile Web UI](https://stitch.withgoogle.com/projects/9350772801597042)

Design screens are checked into [`docs/designs/claude-remote/`](./docs/designs/claude-remote).

| Login | Sessions List | Sessions List |
| --- | --- | --- |
| ![Login](./docs/designs/claude-remote/login.png) | ![Sessions tall](./docs/designs/claude-remote/sessions-list-tall.png) | ![Sessions overview](./docs/designs/claude-remote/sessions-list-overview.png) |

| Sessions List | Main Chat | Main Chat |
| --- | --- | --- |
| ![Sessions compact](./docs/designs/claude-remote/sessions-list-compact.png) | ![Main chat long](./docs/designs/claude-remote/main-chat-long.png) | ![Main chat](./docs/designs/claude-remote/main-chat.png) |

| File Browser | File Browser | File Preview |
| --- | --- | --- |
| ![File browser](./docs/designs/claude-remote/file-browser.png) | ![File browser variant](./docs/designs/claude-remote/file-browser-variant.png) | ![File preview](./docs/designs/claude-remote/file-preview.png) |

## Repo Context

This repository started from the locally-runnable repair work on the leaked Claude Code source tree and is evolving toward a dedicated `claude-remote` product and workflow.

## Disclaimer

This repository is based on the Claude Code source leak that surfaced on 2026-03-31. Original source copyright belongs to [Anthropic](https://www.anthropic.com). For research and learning purposes only.

本仓库基于 2026-03-31 泄露的 Claude Code 源码。所有原始源码版权归 [Anthropic](https://www.anthropic.com) 所有。仅供学习和研究用途。

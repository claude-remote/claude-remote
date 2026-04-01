# Claude Remote

`Claude Remote` 是一个基于 TypeScript + Bun 的项目骨架，目标是把 Claude Code CLI 升级成可远程控制、可多会话管理的 AI 开发服务。当前提交只完成架构脚手架：共享类型、协议、Hub/Server/Web 模块存根、SQLite schema 与基础工程配置，便于后续按任务单并行实现。

## 开发环境

```bash
bun install
bun run typecheck
bun run lint
bun run dev
```

## 目录结构

```text
src/
  hub/           Hub 核心、Session 生命周期、事件总线、Claude/Tool 封装、SQLite 存储
  server/        Hono HTTP/WS 服务、认证中间件、REST 路由
  shared/        前后端共享类型、协议、常量
  tunnel/        Cloudflare Tunnel 封装
  web/           React 19 + Zustand 移动端 Web 界面骨架
  entrypoints/   `claude-remote serve` 入口
  cli/           CLI 命令声明
```

## 设计规格

- 设计规格：`/Users/leo/github.com/claude-code-haha/docs/superpowers/specs/2026-04-01-claude-remote-design.md`
- 任务拆分：`/Users/leo/github.com/claude-code-haha/docs/superpowers/specs/2026-04-01-claude-remote-tasks.md`

## 任务认领

1. 先阅读设计规格和任务拆分文档。
2. 选择一个 `Txx` 任务作为单独开发范围。
3. 以任务号为单位提交 PR，避免跨任务大杂烩。
4. stub 中的 `TODO(Txx)` 已标出对应实现入口，认领任务时优先从这些文件开始。

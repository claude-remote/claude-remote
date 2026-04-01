# Claude Remote

> Attach to the AI coding session running on your development machine, instead of opening a second-class remote chat box.

## Why Claude Remote

Claude Remote is aimed at a different problem than a generic web chat wrapper.

- The session should live on the development machine, not in a browser tab.
- The real working directory, shell, git state, tools, MCP config, and local credentials should stay where the code is.
- A phone, terminal, and future desktop client should be able to attach to the same session.
- Disconnecting the client should not kill the development session.

That is what this repo means by “real remote”.

For domestic developers using overseas development machines or overseas network egress, this is also a practical setup: the model-facing environment stays on the remote machine, while your phone or local terminal becomes a thin client with near-local workflow continuity.

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

That means the current goal is not “ship the full product”, but “make the architecture and contribution path stable enough that multiple developers can start implementing issues in parallel”.

## Why Now

This is the point where other developers can start entering the project **once this branch lands with the contributor docs below**.

The minimum bar for contributor onboarding is:

1. A stable local `serve/status/attach` baseline
2. Clear issue claiming and PR rules
3. A visible project scope and current milestone
4. Product/design context in-repo, not trapped in chat history

The code baseline is already in place on the active branch. The remaining onboarding work is the documentation in this README and [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Quick Start

Requirements:

- Bun `>= 1.2`
- Node.js `>= 18`

Install dependencies:

```bash
bun install
```

Run the current local hub baseline from the repo:

```bash
./bin/claude-remote status
./bin/claude-remote serve
./bin/claude-remote attach
```

Current expected behavior:

- `status` prints local hub state
- `serve` starts the local hub over Unix socket
- `attach` connects to the hub and attaches to a local session

## Contributor Workflow

The contributor rules live in [`CONTRIBUTING.md`](./CONTRIBUTING.md). The short version:

- Claim work by commenting `/claim` on an issue
- Work one issue per branch and one issue per PR
- Use branch names like `issue-12-local-hub-client`
- Open draft PRs first
- Move issue/project status through the Project Board columns as work progresses

## Specs And Plans

- Main product spec: [`docs/superpowers/specs/2026-04-01-claude-remote-design.md`](./docs/superpowers/specs/2026-04-01-claude-remote-design.md)
- Local baseline spec: [`docs/superpowers/specs/2026-04-01-local-hub-baseline-design.md`](./docs/superpowers/specs/2026-04-01-local-hub-baseline-design.md)
- Local baseline plan: [`docs/superpowers/plans/2026-04-01-local-hub-baseline.md`](./docs/superpowers/plans/2026-04-01-local-hub-baseline.md)

## Design Screens

Stitch project:
[Claude Remote - Mobile Web UI](https://stitch.withgoogle.com/projects/9350772801597042)

Current mobile design screens from Stitch are checked into the repo under [`docs/designs/claude-remote/`](./docs/designs/claude-remote).

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

This repository is based on the Claude Code source leak that surfaced on 2026-03-31. Original source copyright belongs to Anthropic. This repo is for research and learning purposes.

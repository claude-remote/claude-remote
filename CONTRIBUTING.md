# Contributing

## Goal

The current milestone is **Local Hub Baseline + Contributor Onramp**.

If you are picking up work in this repo, optimize for:

- Small issue-sized PRs
- Minimal overlap with other contributors
- Fast reviewable progress
- Keeping product intent aligned with the written specs

## Before You Start

Read these first:

- [`README.md`](./README.md)
- [`docs/superpowers/specs/2026-04-01-claude-remote-design.md`](./docs/superpowers/specs/2026-04-01-claude-remote-design.md)
- [`docs/superpowers/specs/2026-04-01-local-hub-baseline-design.md`](./docs/superpowers/specs/2026-04-01-local-hub-baseline-design.md)
- [`docs/superpowers/plans/2026-04-01-local-hub-baseline.md`](./docs/superpowers/plans/2026-04-01-local-hub-baseline.md)

## Claiming Work

Use issue comments to claim work.

Claim format:

```text
/claim
```

Claim rules:

- Do not start coding an issue that is already claimed by someone else
- One contributor should own one issue at a time unless explicitly coordinating a larger slice
- If you stop working on an issue, leave a comment so someone else can pick it up

Recommended claim follow-up comment:

```text
/claim
Working on the Local Hub client handshake in this issue.
```

## Branch And PR Rules

Use **one issue per branch** and **one issue per PR**.

Branch naming:

```text
issue-<number>-<short-slug>
```

Examples:

- `issue-6-local-hub-protocol`
- `issue-12-hub-attach-command`
- `issue-28-readme-contributor-onramp`

PR rules:

- Open a **draft PR first**
- Keep scope tight to the claimed issue
- Link the issue in the PR description
- Do not mix unrelated cleanup into the same PR
- If you discover a separate problem, open or reference another issue

## Project Board Flow

Use the **Claude Remote Development** Project Board to reflect progress.

Recommended column flow:

1. `Todo`
2. `Claimed`
3. `In Progress`
4. `In Review`
5. `Done`

Expected behavior:

- Move the issue to `Claimed` when you comment `/claim`
- Move it to `In Progress` when coding starts
- Move it to `In Review` when the draft PR is ready for review
- Move it to `Done` only after merge

## Development Notes

Current repo-local commands:

```bash
bun install
./bin/claude-remote status
./bin/claude-remote serve
./bin/claude-remote attach
```

Important current limitation:

- The local hub baseline is real, but hub-backed chat execution is not implemented yet

That means many issues in this phase are infrastructure, protocol, CLI, onboarding, and UI-shell work, not end-to-end assistant execution.

## Coding Expectations

- Follow existing TypeScript/Bun patterns in the repo
- Prefer focused tests near the code you change
- Keep patches small and reviewable
- Preserve the product naming: use `claude-remote`, not `claude-haha`
- Do not silently widen scope beyond the issue you claimed

## Good First Contributions In This Phase

- Local hub protocol and snapshot/event plumbing
- `attach` / session lifecycle improvements
- REPL hub-mode placeholder behavior
- README and onboarding docs
- Design-to-implementation slicing
- Web shell scaffolding behind stable interfaces

## Review Standard

A PR is ready when:

- The claimed issue scope is complete
- Focused tests pass
- The branch is rebased or otherwise mergeable
- The PR description explains what changed and what is still intentionally not implemented

If a task depends on missing architecture, stop and raise it in the issue instead of guessing.

# Local Hub Baseline + Contributor Onramp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local-only Claude Remote foundation: `serve` / `attach` / `status`, Unix Socket Hub transport, minimal snapshot-event session flow, and contributor onboarding docs so other developers can pick up issues immediately.

**Architecture:** Reuse the existing CLI entrypoints and direct-connect/server patterns, but add a new local `src/hub/` slice that owns an in-memory session registry and a Unix Socket protocol. TUI becomes a minimal Hub client for this milestone, while `chat` remains intentionally unimplemented and returns a structured protocol error.

**Tech Stack:** Bun, TypeScript, Commander, existing Ink/TUI stack, Node/Bun Unix domain sockets, Markdown docs

---

### Task 1: Define the Hub protocol and minimal session model

**Files:**
- Create: `src/hub/HubProtocol.ts`
- Create: `src/hub/HubProtocol.test.ts`
- Create: `src/hub/SessionRegistry.ts`
- Create: `src/hub/SessionRegistry.test.ts`
- Reference: `src/server/types.ts`
- Reference: `docs/superpowers/specs/2026-04-01-local-hub-baseline-design.md`

- [ ] **Step 1: Write the failing protocol test**

```ts
import { describe, expect, test } from 'bun:test'
import {
  createNotImplementedChatError,
  isHubResponse,
  type ClientCommand,
} from './HubProtocol.js'

describe('HubProtocol', () => {
  test('builds a structured not_implemented chat error', () => {
    const response = createNotImplementedChatError('cmd-1')

    expect(isHubResponse(response)).toBe(true)
    expect(response).toMatchObject({
      type: 'error',
      cmdId: 'cmd-1',
      code: 'not_implemented',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/hub/HubProtocol.test.ts`
Expected: FAIL because `HubProtocol.ts` does not exist yet.

- [ ] **Step 3: Write the failing session registry test**

```ts
import { describe, expect, test } from 'bun:test'
import { SessionRegistry } from './SessionRegistry.js'

describe('SessionRegistry', () => {
  test('creates and lists a default in-memory session', () => {
    const registry = new SessionRegistry()
    const session = registry.createSession({
      cwd: '/tmp/project',
      name: 'test session',
    })

    expect(session.cwd).toBe('/tmp/project')
    expect(registry.listSessions()).toHaveLength(1)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/hub/SessionRegistry.test.ts`
Expected: FAIL because `SessionRegistry.ts` does not exist yet.

- [ ] **Step 5: Implement the minimal protocol types and registry**

```ts
export type ClientCommand =
  | { cmdId: string; cmd: 'session:create'; cwd: string; name?: string }
  | { cmdId: string; cmd: 'session:list' }
  | { cmdId: string; cmd: 'session:attach'; sessionId: string }
  | { cmdId: string; cmd: 'chat'; text: string }
  | { cmdId: string; cmd: 'hub:status' }

export type HubResponse =
  | { type: 'snapshot'; session: Session }
  | { type: 'event'; event: HubEvent }
  | { type: 'reply'; cmdId: string; data: unknown }
  | { type: 'error'; cmdId: string; error: string; code?: string }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/hub/HubProtocol.test.ts src/hub/SessionRegistry.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/hub/HubProtocol.ts src/hub/HubProtocol.test.ts src/hub/SessionRegistry.ts src/hub/SessionRegistry.test.ts
git commit -m "feat: add local hub protocol and session registry"
```

### Task 2: Build the local Unix Socket Hub server

**Files:**
- Create: `src/hub/LocalSocketServer.ts`
- Create: `src/hub/LocalSocketServer.test.ts`
- Create: `src/hub/Hub.ts`
- Create: `src/hub/Hub.test.ts`
- Reference: `src/server/types.ts`
- Reference: `src/main.tsx`

- [ ] **Step 1: Write the failing local socket server test**

```ts
import { describe, expect, test } from 'bun:test'
import { LocalSocketServer } from './LocalSocketServer.js'

describe('LocalSocketServer', () => {
  test('starts on a unix socket path', async () => {
    const server = new LocalSocketServer('/tmp/claude-remote-test.sock')
    await server.start()

    expect(server.address()).toBe('/tmp/claude-remote-test.sock')

    await server.stop()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/hub/LocalSocketServer.test.ts`
Expected: FAIL because the server implementation does not exist yet.

- [ ] **Step 3: Write the failing hub lifecycle test**

```ts
import { describe, expect, test } from 'bun:test'
import { Hub } from './Hub.js'

describe('Hub', () => {
  test('reports running status after start', async () => {
    const hub = new Hub({ socketPath: '/tmp/claude-remote-hub.sock' })
    await hub.start()

    expect(hub.getStatus().running).toBe(true)

    await hub.stop()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/hub/Hub.test.ts`
Expected: FAIL because `Hub.ts` does not exist yet.

- [ ] **Step 5: Implement the minimal Unix Socket server and Hub orchestration**

```ts
export class Hub {
  async start(): Promise<void> {
    // Start SessionRegistry + LocalSocketServer
  }

  getStatus() {
    return { running: true, sessionCount: 0, connectionCount: 0 }
  }

  async stop(): Promise<void> {
    // Close socket and cleanup socket file
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/hub/LocalSocketServer.test.ts src/hub/Hub.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/hub/LocalSocketServer.ts src/hub/LocalSocketServer.test.ts src/hub/Hub.ts src/hub/Hub.test.ts
git commit -m "feat: add local hub unix socket server"
```

### Task 3: Add `serve` and `status` CLI commands

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/entrypoints/cli.tsx`
- Create: `src/hub/paths.ts`
- Create: `src/hub/paths.test.ts`
- Create: `src/cli/handlers/hub.ts`
- Create: `src/cli/handlers/hub.test.ts`

- [ ] **Step 1: Write the failing socket path helper test**

```ts
import { describe, expect, test } from 'bun:test'
import { getHubSocketPath } from '../../src/hub/paths.js'

describe('hub paths', () => {
  test('returns the default unix socket path under ~/.claude-remote', () => {
    expect(getHubSocketPath()).toContain('.claude-remote')
    expect(getHubSocketPath()).toContain('hub.sock')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/hub/paths.test.ts`
Expected: FAIL because `paths.ts` does not exist yet.

- [ ] **Step 3: Write the failing CLI handler test**

```ts
import { describe, expect, test } from 'bun:test'
import { formatHubStatus } from './hub.js'

describe('hub handler formatting', () => {
  test('formats running status output', () => {
    const text = formatHubStatus({
      running: true,
      sessionCount: 2,
      connectionCount: 1,
      socketPath: '/tmp/hub.sock',
    })

    expect(text).toContain('running')
    expect(text).toContain('/tmp/hub.sock')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/cli/handlers/hub.test.ts`
Expected: FAIL because the handler does not exist yet.

- [ ] **Step 5: Implement `serve` / `status` handlers and wire them into Commander**

```ts
program
  .command('serve')
  .description('Start the local Claude Remote hub')
  .action(async () => {
    const { serveHubHandler } = await import('./cli/handlers/hub.js')
    await serveHubHandler()
  })

program
  .command('status')
  .description('Show local Claude Remote hub status')
  .action(async () => {
    const { statusHubHandler } = await import('./cli/handlers/hub.js')
    await statusHubHandler()
  })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/hub/paths.test.ts src/cli/handlers/hub.test.ts`
Expected: PASS

- [ ] **Step 7: Run a manual smoke check**

Run: `bun run ./bin/claude-haha status`
Expected: Prints “not running” or equivalent without crashing.

- [ ] **Step 8: Commit**

```bash
git add src/main.tsx src/entrypoints/cli.tsx src/hub/paths.ts src/hub/paths.test.ts src/cli/handlers/hub.ts src/cli/handlers/hub.test.ts
git commit -m "feat: add local hub serve and status commands"
```

### Task 4: Add the local Hub client and `attach` command

**Files:**
- Create: `src/hub/client/HubConnectionState.ts`
- Create: `src/hub/client/HubClient.ts`
- Create: `src/hub/client/HubClient.test.ts`
- Modify: `src/main.tsx`
- Create: `src/cli/handlers/hubAttach.ts`
- Create: `src/cli/handlers/hubAttach.test.ts`

- [ ] **Step 1: Write the failing HubClient test**

```ts
import { describe, expect, test } from 'bun:test'
import { HubClient } from './HubClient.js'

describe('HubClient', () => {
  test('starts disconnected before connect is called', () => {
    const client = new HubClient({ socketPath: '/tmp/hub.sock' })
    expect(client.getConnectionState()).toBe('disconnected')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/hub/client/HubClient.test.ts`
Expected: FAIL because `HubClient.ts` does not exist yet.

- [ ] **Step 3: Write the failing attach handler test**

```ts
import { describe, expect, test } from 'bun:test'
import { ensureHubSessionName } from './hubAttach.js'

describe('hub attach helpers', () => {
  test('uses current cwd as default session metadata input', () => {
    const info = ensureHubSessionName('/tmp/project')
    expect(info.cwd).toBe('/tmp/project')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/cli/handlers/hubAttach.test.ts`
Expected: FAIL because the attach handler does not exist yet.

- [ ] **Step 5: Implement the minimal Hub client and `attach` command wiring**

```ts
program
  .command('attach')
  .description('Attach the TUI to the local Claude Remote hub')
  .action(async () => {
    const { attachHubHandler } = await import('./cli/handlers/hubAttach.js')
    await attachHubHandler()
  })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/hub/client/HubClient.test.ts src/cli/handlers/hubAttach.test.ts`
Expected: PASS

- [ ] **Step 7: Run a manual smoke check**

Run: `bun run ./bin/claude-haha attach`
Expected: Starts or connects to the local hub and prints an attach success message or enters the TUI without crashing.

- [ ] **Step 8: Commit**

```bash
git add src/hub/client/HubConnectionState.ts src/hub/client/HubClient.ts src/hub/client/HubClient.test.ts src/main.tsx src/cli/handlers/hubAttach.ts src/cli/handlers/hubAttach.test.ts
git commit -m "feat: add local hub attach client"
```

### Task 5: Route TUI prompt submission through the Hub baseline

**Files:**
- Modify: `src/screens/REPL.tsx`
- Create: `src/hub/client/HubReplAdapter.ts`
- Create: `src/hub/client/HubReplAdapter.test.ts`
- Reference: `src/screens/REPL.tsx`

- [ ] **Step 1: Write the failing REPL adapter test**

```ts
import { describe, expect, test } from 'bun:test'
import { mapHubChatErrorToNotice } from './HubReplAdapter.js'

describe('HubReplAdapter', () => {
  test('maps not_implemented chat errors to a user-facing notice', () => {
    expect(
      mapHubChatErrorToNotice({
        type: 'error',
        cmdId: '1',
        code: 'not_implemented',
        error: 'chat is not implemented in Local Hub Baseline',
      }),
    ).toContain('尚未实现')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/hub/client/HubReplAdapter.test.ts`
Expected: FAIL because `HubReplAdapter.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal REPL integration**

```ts
if (hubModeEnabled) {
  const result = await hubClient.sendChat(input)
  if (result.type === 'error' && result.code === 'not_implemented') {
    appendSystemMessage('Hub 基线已连接，但 chat 尚未实现')
    return
  }
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `bun test src/hub/client/HubReplAdapter.test.ts`
Expected: PASS

- [ ] **Step 5: Run a manual smoke check**

Run:

```bash
bun run ./bin/claude-haha serve
bun run ./bin/claude-haha attach
```

Expected: Typing a prompt in the REPL yields a clear structured “Hub baseline connected, chat not implemented yet” notice instead of silent failure.

- [ ] **Step 6: Commit**

```bash
git add src/screens/REPL.tsx src/hub/client/HubReplAdapter.ts src/hub/client/HubReplAdapter.test.ts
git commit -m "feat: surface hub baseline chat placeholder in repl"
```

### Task 6: Add contributor onboarding and remote product positioning docs

**Files:**
- Modify: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/designs/claude-remote/`
- Modify: `docs/superpowers/specs/2026-04-01-local-hub-baseline-design.md` (only if doc clarifications are needed during implementation)

- [ ] **Step 1: Gather the design assets from Stitch**

Collect and save the key screens under:

```text
docs/designs/claude-remote/
```

Required screens:
- `login`
- `sessions-list`
- `main-chat`
- `file-browser`
- `file-preview`

- [ ] **Step 2: Write the README update**

README must add:
- Why Claude Remote exists
- Why this is “real remote”
- Why it works well for domestic developers using overseas dev machines
- Current milestone status
- Stitch project link
- All exported key design screens

- [ ] **Step 3: Write `CONTRIBUTING.md`**

Include:
- `/claim` issue workflow
- `codex/issue-<id>-<slug>` branch naming
- one issue per draft PR
- Project Board column rules

- [ ] **Step 4: Verify the docs render correctly**

Run:

```bash
rg -n "Why Remote|Why This Is Real Remote|/claim|Draft PR|Project Board" README.md CONTRIBUTING.md
```

Expected: Matches are found in both files.

- [ ] **Step 5: Commit**

```bash
git add README.md CONTRIBUTING.md docs/designs/claude-remote
git commit -m "docs: add contributor guide and remote positioning"
```

### Task 7: Final milestone verification

**Files:**
- Modify: none unless fixes are needed

- [ ] **Step 1: Run the focused test suite**

Run:

```bash
bun test \
  src/hub/HubProtocol.test.ts \
  src/hub/SessionRegistry.test.ts \
  src/hub/LocalSocketServer.test.ts \
  src/hub/Hub.test.ts \
  src/hub/paths.test.ts \
  src/cli/handlers/hub.test.ts \
  src/hub/client/HubClient.test.ts \
  src/cli/handlers/hubAttach.test.ts \
  src/hub/client/HubReplAdapter.test.ts
```

Expected: PASS

- [ ] **Step 2: Run end-to-end smoke checks**

Run:

```bash
bun run ./bin/claude-haha status
bun run ./bin/claude-haha serve
bun run ./bin/claude-haha status
bun run ./bin/claude-haha attach
```

Expected:
- `status` works before and after startup
- `serve` starts the hub and socket
- `attach` connects cleanly
- REPL prompt shows the `not_implemented` placeholder instead of failing silently

- [ ] **Step 3: Review the milestone against the spec**

Check:
- [ ] `serve` exists
- [ ] `attach` exists
- [ ] `status` exists
- [ ] snapshot/event baseline exists
- [ ] `chat` returns `not_implemented`
- [ ] README includes exported designs and positioning
- [ ] CONTRIBUTING explains `/claim` + draft PR flow

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: finalize local hub baseline milestone"
```

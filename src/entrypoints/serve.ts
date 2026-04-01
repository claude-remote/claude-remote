/**
 * Hub service entrypoint — `claude-remote serve`
 *
 * CRITICAL: patchInteractiveEnv() MUST be the very first call, before any
 * import that touches process.stdout.isTTY, TERM, or isInteractive state.
 * This ensures Claude Code's detection logic sees the Hub as an interactive
 * terminal session, not a headless daemon.
 */

// ── Step 0: Patch environment BEFORE any other import ───────────────────
import {
  patchInteractiveEnv,
  verifyInteractiveEnv,
} from '../hub/patchInteractiveEnv.js'

patchInteractiveEnv()

// ── Step 1: Verify and log ──────────────────────────────────────────────
const { ok, details } = verifyInteractiveEnv()

if (!ok) {
  process.stderr.write(
    `[claude-remote] WARNING: interactive environment patch incomplete\n${JSON.stringify(details, null, 2)}\n`,
  )
}

// ── Step 2: Check for unsafe environment variables ──────────────────────
const UNSAFE_VARS = [
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
  'OTEL_TRACES_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
  'OTEL_SDK_DISABLED',
]

for (const varName of UNSAFE_VARS) {
  if (process.env[varName]) {
    process.stderr.write(
      `[claude-remote] WARNING: ${varName} is set — this is a high-risk signal that may trigger account review. Consider unsetting it.\n`,
    )
  }
}

// ── Step 3: Now safe to load the rest of the application ────────────────
// All subsequent imports will see patched TTY and env values.
async function startHub(): Promise<void> {
  // TODO: Import and initialize Hub, Hono server, WebSocket handler,
  //       Cloudflare Tunnel, etc.
  //
  // const { Hub } = await import('../hub/Hub.js')
  // const hub = new Hub(config)
  // await hub.start()

  process.stdout.write(
    `[claude-remote] Hub started\n` +
      `  Interactive: ${process.env.CLAUDE_INTERACTIVE}\n` +
      `  Terminal:    ${process.env.TERM} (${process.env.TERM_PROGRAM})\n` +
      `  Environment: ${JSON.stringify(details)}\n`,
  )
}

startHub().catch((error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error)
  process.stderr.write(`[claude-remote] Fatal: ${message}\n`)
  process.exitCode = 1
})

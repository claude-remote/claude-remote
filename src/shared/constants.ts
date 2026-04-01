import { readFileSync } from 'node:fs'

export const DEFAULT_PORT = 7680
export const DEFAULT_HUB_DIR = '~/.claude-remote/'
export const DEFAULT_IDLE_TIMEOUT_MS = 1_800_000
export const MAX_SESSIONS = 50
export const WS_TICKET_TTL_MS = 30_000
export const BOOTSTRAP_TOKEN_TTL_MS = 300_000
export const JWT_EXPIRY = '7d'
export const BACKPRESSURE_QUEUE_LIMIT = 1000

let VERSION = '0.0.0'
try {
  const packageJson = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version?: string }
  VERSION = packageJson.version ?? VERSION
} catch {
  // Keep fallback version for environments where package.json is unavailable.
}

export { VERSION }

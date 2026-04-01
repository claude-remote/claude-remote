import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'

export type HubLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type HubTunnelProvider = 'cloudflare'

export type HubConfig = {
  port: number
  logLevel: HubLogLevel
  maxSessions: number
  maxMessagesInMemory: number
  maxConcurrentTools: number
  maxConnectionsPerSession: number
  idleTimeoutMs: number
  sessionTokenTtl: string
  totpEnabled: boolean
  allowedRoots: string[]
  excludedDirs: string[]
  tunnelAutoStart: boolean
  tunnelProvider: HubTunnelProvider
}

export type HubConfigOverrides = Partial<HubConfig>

type HubConfigFile = {
  server?: {
    port?: number
    log_level?: string
  }
  limits?: {
    max_sessions?: number
    max_messages_in_memory?: number
    max_concurrent_tools?: number
    max_connections_per_session?: number
    idle_timeout_ms?: number
  }
  auth?: {
    session_token_ttl?: string
    totp_enabled?: boolean
  }
  files?: {
    allowed_roots?: string[]
    excluded_dirs?: string[]
  }
  tunnel?: {
    auto_start?: boolean
    provider?: string
  }
}

export const DEFAULT_HUB_CONFIG: HubConfig = {
  port: 3456,
  logLevel: 'info',
  maxSessions: 10,
  maxMessagesInMemory: 1000,
  maxConcurrentTools: 5,
  maxConnectionsPerSession: 10,
  idleTimeoutMs: 1_800_000,
  sessionTokenTtl: '7d',
  totpEnabled: false,
  allowedRoots: ['~'],
  excludedDirs: ['.ssh', '.gnupg', '.claude-remote'],
  tunnelAutoStart: false,
  tunnelProvider: 'cloudflare',
}

type LoadHubConfigOptions = {
  cli?: HubConfigOverrides
  configPath?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export function getDefaultHubConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getHomeDir(env), '.claude-remote', 'config.toml')
}

export function loadHubConfig(options: LoadHubConfigOptions = {}): HubConfig {
  const env = options.env ?? process.env
  const configPath = options.configPath ?? getDefaultHubConfigPath(env)
  const cwd = options.cwd ?? process.cwd()
  const homeDir = getHomeDir(env)

  const fileConfig = loadHubConfigFile(configPath)
  const envConfig = loadHubConfigFromEnv(env)
  const cliConfig = options.cli ?? {}

  const merged: HubConfig = {
    ...DEFAULT_HUB_CONFIG,
    ...definedEntries(fileConfig),
    ...definedEntries(envConfig),
    ...definedEntries(cliConfig),
  }

  return validateHubConfig(merged, { cwd, homeDir })
}

function loadHubConfigFile(configPath: string): HubConfigOverrides {
  if (!existsSync(configPath)) {
    return {}
  }

  const raw = readFileSync(configPath, 'utf8')
  const parsed = parseToml(raw) as HubConfigFile

  return {
    port: parsed.server?.port,
    logLevel: parseLogLevel(parsed.server?.log_level, 'server.log_level'),
    maxSessions: parsed.limits?.max_sessions,
    maxMessagesInMemory: parsed.limits?.max_messages_in_memory,
    maxConcurrentTools: parsed.limits?.max_concurrent_tools,
    maxConnectionsPerSession: parsed.limits?.max_connections_per_session,
    idleTimeoutMs: parsed.limits?.idle_timeout_ms,
    sessionTokenTtl: parsed.auth?.session_token_ttl,
    totpEnabled: parsed.auth?.totp_enabled,
    allowedRoots: parsed.files?.allowed_roots,
    excludedDirs: parsed.files?.excluded_dirs,
    tunnelAutoStart: parsed.tunnel?.auto_start,
    tunnelProvider: parseTunnelProvider(parsed.tunnel?.provider, 'tunnel.provider'),
  }
}

function loadHubConfigFromEnv(env: NodeJS.ProcessEnv): HubConfigOverrides {
  return {
    port: parseInteger(env.CLAUDE_REMOTE_PORT, 'CLAUDE_REMOTE_PORT'),
    logLevel: parseLogLevel(
      env.CLAUDE_REMOTE_LOG_LEVEL,
      'CLAUDE_REMOTE_LOG_LEVEL',
    ),
    maxSessions: parseInteger(
      env.CLAUDE_REMOTE_MAX_SESSIONS,
      'CLAUDE_REMOTE_MAX_SESSIONS',
    ),
    maxMessagesInMemory: parseInteger(
      env.CLAUDE_REMOTE_MAX_MESSAGES_IN_MEMORY,
      'CLAUDE_REMOTE_MAX_MESSAGES_IN_MEMORY',
    ),
    maxConcurrentTools: parseInteger(
      env.CLAUDE_REMOTE_MAX_CONCURRENT_TOOLS,
      'CLAUDE_REMOTE_MAX_CONCURRENT_TOOLS',
    ),
    maxConnectionsPerSession: parseInteger(
      env.CLAUDE_REMOTE_MAX_CONNECTIONS_PER_SESSION,
      'CLAUDE_REMOTE_MAX_CONNECTIONS_PER_SESSION',
    ),
    idleTimeoutMs: parseInteger(
      env.CLAUDE_REMOTE_IDLE_TIMEOUT_MS,
      'CLAUDE_REMOTE_IDLE_TIMEOUT_MS',
    ),
    sessionTokenTtl: env.CLAUDE_REMOTE_SESSION_TOKEN_TTL || undefined,
    totpEnabled: parseBoolean(
      env.CLAUDE_REMOTE_TOTP_ENABLED,
      'CLAUDE_REMOTE_TOTP_ENABLED',
    ),
    allowedRoots: parseList(env.CLAUDE_REMOTE_ALLOWED_ROOTS),
    excludedDirs: parseList(env.CLAUDE_REMOTE_EXCLUDED_DIRS),
    tunnelAutoStart: parseBoolean(
      env.CLAUDE_REMOTE_TUNNEL_AUTO_START,
      'CLAUDE_REMOTE_TUNNEL_AUTO_START',
    ),
    tunnelProvider: parseTunnelProvider(
      env.CLAUDE_REMOTE_TUNNEL_PROVIDER,
      'CLAUDE_REMOTE_TUNNEL_PROVIDER',
    ),
  }
}

function validateHubConfig(
  config: HubConfig,
  options: { cwd: string; homeDir: string },
): HubConfig {
  assertIntegerInRange(config.port, 1, 65535, 'port')
  assertIntegerInRange(config.maxSessions, 1, Number.MAX_SAFE_INTEGER, 'maxSessions')
  assertIntegerInRange(
    config.maxMessagesInMemory,
    1,
    Number.MAX_SAFE_INTEGER,
    'maxMessagesInMemory',
  )
  assertIntegerInRange(
    config.maxConcurrentTools,
    1,
    Number.MAX_SAFE_INTEGER,
    'maxConcurrentTools',
  )
  assertIntegerInRange(
    config.maxConnectionsPerSession,
    1,
    Number.MAX_SAFE_INTEGER,
    'maxConnectionsPerSession',
  )
  assertIntegerInRange(
    config.idleTimeoutMs,
    0,
    Number.MAX_SAFE_INTEGER,
    'idleTimeoutMs',
  )

  if (!LOG_LEVELS.includes(config.logLevel)) {
    throw new Error(`Invalid logLevel: ${config.logLevel}`)
  }
  if (!TUNNEL_PROVIDERS.includes(config.tunnelProvider)) {
    throw new Error(`Invalid tunnelProvider: ${config.tunnelProvider}`)
  }
  if (!config.sessionTokenTtl.trim()) {
    throw new Error('sessionTokenTtl must be a non-empty string')
  }
  if (!Array.isArray(config.allowedRoots) || config.allowedRoots.length === 0) {
    throw new Error('allowedRoots must contain at least one path')
  }
  if (!Array.isArray(config.excludedDirs)) {
    throw new Error('excludedDirs must be an array')
  }
  if (!config.allowedRoots.every(root => typeof root === 'string')) {
    throw new Error('allowed_roots must be an array of strings')
  }
  if (!config.excludedDirs.every(dir => typeof dir === 'string')) {
    throw new Error('excluded_dirs must be an array of strings')
  }

  const allowedRoots = config.allowedRoots.map(root =>
    normalizeRootPath(root, options),
  )

  return {
    ...config,
    allowedRoots,
  }
}

function normalizeRootPath(
  input: string,
  options: { cwd: string; homeDir: string },
): string {
  const expanded = input === '~' || input.startsWith('~/')
    ? join(options.homeDir, input.slice(2))
    : input

  const normalized = isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(options.cwd, expanded)

  if (!existsSync(normalized)) {
    throw new Error(`Invalid allowed_roots entry: ${input}`)
  }

  return normalized
}

function parseToml(input: string): unknown {
  if (typeof Bun !== 'undefined') {
    return Bun.TOML.parse(input)
  }

  throw new Error('Hub config TOML parsing requires Bun')
}

function getHomeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME || homedir()
}

function parseInteger(
  value: string | undefined,
  field: string,
): number | undefined {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Invalid ${field}: ${value}`)
  }

  const parsed = Number.parseInt(trimmed, 10)
  return parsed
}

function parseBoolean(
  value: string | undefined,
  field: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) {
    return false
  }

  throw new Error(`Invalid ${field}: ${value}`)
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined
  }

  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
const TUNNEL_PROVIDERS = ['cloudflare'] as const

function parseLogLevel(
  value: string | undefined,
  field: string,
): HubLogLevel | undefined {
  if (!value) {
    return undefined
  }

  if (!LOG_LEVELS.includes(value as HubLogLevel)) {
    throw new Error(`Invalid ${field}: ${value}`)
  }

  return value as HubLogLevel
}

function parseTunnelProvider(
  value: string | undefined,
  field: string,
): HubTunnelProvider | undefined {
  if (!value) {
    return undefined
  }

  if (!TUNNEL_PROVIDERS.includes(value as HubTunnelProvider)) {
    throw new Error(`Invalid ${field}: ${value}`)
  }

  return value as HubTunnelProvider
}

function assertIntegerInRange(
  value: number,
  min: number,
  max: number,
  field: string,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${field}: ${value}`)
  }
}

function definedEntries<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>
}

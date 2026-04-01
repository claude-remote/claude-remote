export const CLAUDE_REMOTE_VERSION = '0.1.0';
export const DEFAULT_PORT = 7680;

export const DEFAULT_CONFIG_DIR = '~/.claude-remote';
export const DEFAULT_DATABASE_PATH = '~/.claude-remote/hub.db';
export const DEFAULT_TOKEN_PATH = '~/.claude-remote/hub.token';
export const DEFAULT_SOCKET_PATH = '~/.claude-remote/hub.sock';
export const DEFAULT_CONFIG_PATH = '~/.claude-remote/config.toml';
export const DEFAULT_LOG_DIR = '~/.claude-remote/logs';

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_WS_TICKET_TTL_MS = 30 * 1000;
export const DEFAULT_BOOTSTRAP_TOKEN_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_SESSION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_SESSION_TOKEN_RENEW_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TAKEOVER_TIMEOUT_MS = 60 * 1000;
export const DEFAULT_TOOL_QUEUE_TIMEOUT_MS = 30 * 1000;
export const DEFAULT_AUTH_BLOCK_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_AUTH_TOKEN_BYTES = 32;
export const DEFAULT_AUTH_RATE_LIMIT_MAX_FAILURES = 5;

export const DEFAULT_MAX_SESSIONS = 10;
export const DEFAULT_MAX_MESSAGES_IN_MEMORY = 1000;
export const DEFAULT_MAX_CONCURRENT_TOOLS = 5;
export const DEFAULT_MAX_CONNECTIONS_PER_SESSION = 10;
export const DEFAULT_MAX_CONCURRENT_API_CALLS = 2;
export const DEFAULT_MAX_API_CALLS_PER_MINUTE = 20;
export const DEFAULT_MAX_API_CALLS_PER_HOUR = 300;
export const DEFAULT_MIN_INTER_REQUEST_DELAY_MS = 1000;

export const DEFAULT_ALLOWED_ROOTS = ['~'];
export const DEFAULT_EXCLUDED_DIRS = ['.ssh', '.gnupg', '.claude-remote'];
export const SESSION_COOKIE_NAME = 'claude-remote-session';

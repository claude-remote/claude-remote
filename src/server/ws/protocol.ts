import type { ClientCommand, HubEvent, HubResponse } from '@/shared/protocol';
import type { SessionSnapshot, WriterStatus } from '@/shared/types';

// ── Valid command names ──────────────────────────────────────────────

const VALID_COMMANDS = new Set<string>([
  'chat',
  'chat:abort',
  'control:respond',
  'session:create',
  'session:list',
  'session:switch',
  'session:rename',
  'session:archive',
  'session:takeOver',
  'session:takeOver:approve',
  'session:takeOver:reject',
  'session:releaseWriter',
  'cwd:change',
  'cwd:browse',
  'cwd:favorites',
  'cwd:addFavorite',
  'skill:list',
  'skill:invoke',
  'config:get',
  'config:set',
  'context:usage',
  'cost:get',
  'mcp:list',
  'mcp:toggle',
  'mcp:reconnect',
  'chat:branch',
  'chat:compact',
  'chat:export',
  'chat:clear',
  'file:read',
  'file:list',
  'file:search',
  'history:search',
]);

// ── Writer-only commands (require active writer role) ────────────────

const WRITER_ONLY_COMMANDS = new Set<string>([
  'chat',
  'chat:abort',
  'control:respond',
  'session:create',
  'session:rename',
  'session:archive',
  'cwd:change',
  'cwd:addFavorite',
  'skill:invoke',
  'config:set',
  'chat:branch',
  'chat:compact',
  'chat:clear',
  'mcp:toggle',
  'mcp:reconnect',
]);

// ── Standby-only commands ────────────────────────────────────────────

const STANDBY_ONLY_COMMANDS = new Set<string>(['session:takeOver']);

// ── Required fields per command ──────────────────────────────────────

const REQUIRED_FIELDS: Record<string, string[]> = {
  chat: ['text'],
  'control:respond': ['requestId', 'response'],
  'session:create': ['cwd'],
  'session:switch': ['sessionId'],
  'session:rename': ['name'],
  'session:archive': ['sessionId'],
  'cwd:change': ['path'],
  'cwd:browse': ['path'],
  'cwd:addFavorite': ['path'],
  'skill:invoke': ['name'],
  'config:set': ['patch'],
  'mcp:toggle': ['serverId', 'enabled'],
  'mcp:reconnect': ['serverId'],
  'chat:branch': ['messageId'],
  'chat:export': ['format'],
  'file:read': ['path'],
  'file:list': ['path'],
  'file:search': ['pattern'],
  'history:search': ['query', 'scope'],
};

// ── Parse ────────────────────────────────────────────────────────────

/**
 * Parse a raw WebSocket text frame into a ClientCommand.
 * Returns null if the payload is not valid JSON or not a recognisable command.
 */
export function parseClientCommand(raw: string): ClientCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.cmdId !== 'string' || typeof obj.cmd !== 'string') {
    return null;
  }

  if (!VALID_COMMANDS.has(obj.cmd)) {
    return null;
  }

  return obj as unknown as ClientCommand;
}

// ── Validate ─────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a parsed ClientCommand for required fields and types.
 */
export function validateCommand(cmd: ClientCommand): ValidationResult {
  if (!cmd.cmdId || typeof cmd.cmdId !== 'string') {
    return { valid: false, error: 'missing or invalid cmdId' };
  }

  if (!VALID_COMMANDS.has(cmd.cmd)) {
    return { valid: false, error: `unknown command: ${cmd.cmd}` };
  }

  const required = REQUIRED_FIELDS[cmd.cmd];
  if (required) {
    for (const field of required) {
      if ((cmd as Record<string, unknown>)[field] === undefined) {
        return { valid: false, error: `missing required field: ${field}` };
      }
    }
  }

  // Additional type checks for specific commands
  if (cmd.cmd === 'chat' && typeof cmd.text !== 'string') {
    return { valid: false, error: 'chat text must be a string' };
  }

  if (cmd.cmd === 'chat:export') {
    if (cmd.format !== 'markdown' && cmd.format !== 'json') {
      return { valid: false, error: 'export format must be "markdown" or "json"' };
    }
  }

  if (cmd.cmd === 'history:search') {
    if (cmd.scope !== 'session' && cmd.scope !== 'all') {
      return { valid: false, error: 'search scope must be "session" or "all"' };
    }
  }

  return { valid: true };
}

// ── Permission check ─────────────────────────────────────────────────

/**
 * Check whether the given writer status is allowed to execute the command.
 * Returns an error string if denied, or null if allowed.
 */
export function checkPermission(cmd: ClientCommand, role: WriterStatus): string | null {
  if (role === 'standby' && WRITER_ONLY_COMMANDS.has(cmd.cmd)) {
    return `command "${cmd.cmd}" requires active writer role`;
  }

  if (role === 'active' && STANDBY_ONLY_COMMANDS.has(cmd.cmd)) {
    return `command "${cmd.cmd}" is only available in standby mode`;
  }

  return null;
}

// ── Serialize ────────────────────────────────────────────────────────

/**
 * Serialize a HubEvent into a WebSocket text frame.
 */
export function serializeEvent(event: HubEvent): string {
  const response: HubResponse = { type: 'event', event };
  return JSON.stringify(response);
}

/**
 * Serialize the initial hello handshake message.
 */
export function serializeHello(hubVersion: string): string {
  const response: HubResponse = { type: 'hello', version: 1, hubVersion };
  return JSON.stringify(response);
}

/**
 * Serialize a session snapshot message.
 */
export function serializeSnapshot(snapshot: SessionSnapshot): string {
  const response: HubResponse = { type: 'snapshot', snapshot };
  return JSON.stringify(response);
}

/**
 * Serialize any HubResponse into a WebSocket text frame.
 */
export function serializeResponse(response: HubResponse): string {
  return JSON.stringify(response);
}

// ── Exports for testing ──────────────────────────────────────────────

export { VALID_COMMANDS, WRITER_ONLY_COMMANDS, STANDBY_ONLY_COMMANDS };

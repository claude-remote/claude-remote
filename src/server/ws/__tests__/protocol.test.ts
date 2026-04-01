import { describe, test, expect } from 'bun:test';
import {
  parseClientCommand,
  validateCommand,
  checkPermission,
  serializeEvent,
  serializeHello,
  serializeSnapshot,
  serializeResponse,
  WRITER_ONLY_COMMANDS,
  STANDBY_ONLY_COMMANDS,
} from '@/server/ws/protocol';
import type { ClientCommand, HubEvent, HubResponse } from '@/shared/protocol';
import type { SessionSnapshot, WriterStatus } from '@/shared/types';

// ── parseClientCommand ──────────────────────────────────────────────

describe('parseClientCommand', () => {
  test('parses a valid chat command', () => {
    const raw = JSON.stringify({ cmdId: 'c1', cmd: 'chat', text: 'hello' });
    const result = parseClientCommand(raw);
    expect(result).not.toBeNull();
    expect(result!.cmd).toBe('chat');
    expect(result!.cmdId).toBe('c1');
  });

  test('parses session:create command', () => {
    const raw = JSON.stringify({
      cmdId: 'c2',
      cmd: 'session:create',
      cwd: '/home/user',
      name: 'test',
    });
    const result = parseClientCommand(raw);
    expect(result).not.toBeNull();
    expect(result!.cmd).toBe('session:create');
  });

  test('parses session:list command', () => {
    const raw = JSON.stringify({ cmdId: 'c3', cmd: 'session:list' });
    const result = parseClientCommand(raw);
    expect(result).not.toBeNull();
    expect(result!.cmd).toBe('session:list');
  });

  test('parses chat:abort command', () => {
    const raw = JSON.stringify({ cmdId: 'c4', cmd: 'chat:abort' });
    const result = parseClientCommand(raw);
    expect(result).not.toBeNull();
    expect(result!.cmd).toBe('chat:abort');
  });

  test('parses history:search command', () => {
    const raw = JSON.stringify({
      cmdId: 'c5',
      cmd: 'history:search',
      query: 'test',
      scope: 'session',
      limit: 10,
    });
    const result = parseClientCommand(raw);
    expect(result).not.toBeNull();
    expect(result!.cmd).toBe('history:search');
  });

  test('returns null for invalid JSON', () => {
    expect(parseClientCommand('not-json{')).toBeNull();
  });

  test('returns null for non-object JSON', () => {
    expect(parseClientCommand('"hello"')).toBeNull();
    expect(parseClientCommand('42')).toBeNull();
    expect(parseClientCommand('null')).toBeNull();
  });

  test('returns null when cmdId is missing', () => {
    const raw = JSON.stringify({ cmd: 'chat', text: 'hello' });
    expect(parseClientCommand(raw)).toBeNull();
  });

  test('returns null when cmd is missing', () => {
    const raw = JSON.stringify({ cmdId: 'c1', text: 'hello' });
    expect(parseClientCommand(raw)).toBeNull();
  });

  test('returns null for unknown command', () => {
    const raw = JSON.stringify({ cmdId: 'c1', cmd: 'unknown:cmd' });
    expect(parseClientCommand(raw)).toBeNull();
  });
});

// ── validateCommand ─────────────────────────────────────────────────

describe('validateCommand', () => {
  test('validates a valid chat command', () => {
    const cmd: ClientCommand = { cmdId: 'c1', cmd: 'chat', text: 'hello' };
    expect(validateCommand(cmd)).toEqual({ valid: true });
  });

  test('rejects chat with non-string text', () => {
    const cmd = { cmdId: 'c1', cmd: 'chat', text: 123 } as unknown as ClientCommand;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('text must be a string');
  });

  test('rejects missing required field for session:create', () => {
    const cmd = { cmdId: 'c1', cmd: 'session:create' } as unknown as ClientCommand;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('cwd');
  });

  test('rejects invalid export format', () => {
    const cmd = {
      cmdId: 'c1',
      cmd: 'chat:export',
      format: 'txt',
    } as unknown as ClientCommand;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('format');
  });

  test('rejects invalid search scope', () => {
    const cmd = {
      cmdId: 'c1',
      cmd: 'history:search',
      query: 'test',
      scope: 'invalid',
    } as unknown as ClientCommand;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('scope');
  });

  test('validates commands with no required fields', () => {
    const cmd: ClientCommand = { cmdId: 'c1', cmd: 'session:list' };
    expect(validateCommand(cmd)).toEqual({ valid: true });
  });

  test('validates chat:abort with no extra fields', () => {
    const cmd: ClientCommand = { cmdId: 'c1', cmd: 'chat:abort' };
    expect(validateCommand(cmd)).toEqual({ valid: true });
  });
});

// ── checkPermission ─────────────────────────────────────────────────

describe('checkPermission', () => {
  test('allows writer to execute writer-only commands', () => {
    for (const cmdName of WRITER_ONLY_COMMANDS) {
      const cmd = { cmdId: 'c1', cmd: cmdName } as ClientCommand;
      expect(checkPermission(cmd, 'active')).toBeNull();
    }
  });

  test('rejects standby from executing writer-only commands', () => {
    for (const cmdName of WRITER_ONLY_COMMANDS) {
      const cmd = { cmdId: 'c1', cmd: cmdName } as ClientCommand;
      const result = checkPermission(cmd, 'standby');
      expect(result).not.toBeNull();
      expect(result).toContain('requires active writer');
    }
  });

  test('allows standby to execute read-only commands', () => {
    const readCommands = [
      'session:list',
      'context:usage',
      'cost:get',
      'mcp:list',
      'skill:list',
      'file:read',
      'file:list',
      'file:search',
      'history:search',
      'chat:export',
      'cwd:browse',
      'cwd:favorites',
      'config:get',
    ];

    for (const cmdName of readCommands) {
      const cmd = { cmdId: 'c1', cmd: cmdName } as ClientCommand;
      expect(checkPermission(cmd, 'standby')).toBeNull();
    }
  });

  test('allows standby to execute session:takeOver', () => {
    const cmd: ClientCommand = { cmdId: 'c1', cmd: 'session:takeOver' };
    expect(checkPermission(cmd, 'standby')).toBeNull();
  });

  test('rejects active writer from executing session:takeOver', () => {
    const cmd: ClientCommand = { cmdId: 'c1', cmd: 'session:takeOver' };
    const result = checkPermission(cmd, 'active');
    expect(result).not.toBeNull();
    expect(result).toContain('only available in standby');
  });
});

// ── serialization ───────────────────────────────────────────────────

describe('serialization', () => {
  test('serializeEvent wraps event in HubResponse', () => {
    const event: HubEvent = {
      type: 'hub:session:statusChanged',
      seq: 1,
      sessionId: 's1',
      status: 'active',
    };
    const serialized = serializeEvent(event);
    const parsed = JSON.parse(serialized) as HubResponse;
    expect(parsed.type).toBe('event');
    expect((parsed as { event: HubEvent }).event.type).toBe(
      'hub:session:statusChanged',
    );
  });

  test('serializeHello produces correct structure', () => {
    const serialized = serializeHello('0.1.0');
    const parsed = JSON.parse(serialized) as HubResponse;
    expect(parsed.type).toBe('hello');
    expect((parsed as { version: number }).version).toBe(1);
    expect((parsed as { hubVersion: string }).hubVersion).toBe('0.1.0');
  });

  test('serializeSnapshot includes snapshot', () => {
    const snapshot: SessionSnapshot = {
      meta: {
        id: 's1',
        name: 'test',
        cwd: '/tmp',
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
        clientCount: 1,
        hasActiveWriter: true,
      },
      recentMessages: [],
      activeTasks: [],
      pendingPermissions: [],
      clients: [],
      availableSkills: [],
      config: { model: 'test', effortLevel: 'high', permissionMode: 'ask' },
      configOptions: {
        availableModels: [],
        effortLevels: ['low', 'medium', 'high'],
        permissionModes: ['ask', 'approve', 'bypass'],
      },
      contextUsage: { usedTokens: 0, maxTokens: 200000, percentage: 0, breakdown: [] },
      costSummary: {
        sessionCost: 0,
        formattedCost: '$0.00',
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        sessionDuration: 0,
      },
      mcpServers: [],
      myWriterStatus: 'active',
      lastSeq: 0,
    };
    const serialized = serializeSnapshot(snapshot);
    const parsed = JSON.parse(serialized);
    expect(parsed.type).toBe('snapshot');
    expect(parsed.snapshot.meta.id).toBe('s1');
  });

  test('serializeResponse handles error response', () => {
    const response: HubResponse = {
      type: 'error',
      cmdId: 'c1',
      error: 'something went wrong',
    };
    const serialized = serializeResponse(response);
    const parsed = JSON.parse(serialized);
    expect(parsed.type).toBe('error');
    expect(parsed.error).toBe('something went wrong');
  });

  test('serializeEvent roundtrip preserves data', () => {
    const event: HubEvent = {
      type: 'hub:client:joined',
      seq: 42,
      sessionId: 's1',
      client: {
        id: 'c1',
        type: 'web',
        writerStatus: 'active',
        connectedAt: 1000,
      },
    };
    const serialized = serializeEvent(event);
    const parsed = JSON.parse(serialized) as { type: string; event: HubEvent };
    expect(parsed.event.seq).toBe(42);
    expect(parsed.event.type).toBe('hub:client:joined');
    if (parsed.event.type === 'hub:client:joined') {
      expect(parsed.event.client.id).toBe('c1');
    }
  });
});

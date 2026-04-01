import { Database } from 'bun:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  HistorySearchResult,
  Message,
  MessageContentBlock,
  Session,
  SessionMeta,
  SessionStatus,
  Task,
} from '@/shared/types';
import {
  DEFAULT_DATABASE_PATH,
  DEFAULT_MAX_MESSAGES_IN_MEMORY,
  DEFAULT_MAX_SESSIONS,
} from '@/shared/constants';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SqliteStoreOptions {
  databasePath?: string;
  maxSessions?: number;
  maxMessagesInMemory?: number;
}

export interface Favorite {
  id: string;
  sessionId: string | null;
  messageId: string | null;
  createdAt: number;
}

export interface ToolExecution {
  id: string;
  sessionId: string;
  toolName: string;
  params: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'crashed';
  result: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/* ------------------------------------------------------------------ */
/*  Row types (snake_case from SQLite)                                 */
/* ------------------------------------------------------------------ */

interface SessionRow {
  id: string;
  name: string;
  status: string;
  cwd: string;
  tags: string;
  config: string;
  created_at: number;
  updated_at: number;
  idle_timeout_ms: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
  seq: number;
}

interface TaskRow {
  id: string;
  session_id: string;
  description: string;
  status: string;
  assignee: string | null;
  created_at: number;
  updated_at: number;
}

interface FavoriteRow {
  id: string;
  session_id: string | null;
  message_id: string | null;
  created_at: number;
}

interface ToolExecutionRow {
  id: string;
  session_id: string;
  tool_name: string;
  params: string;
  status: string;
  result: string | null;
  started_at: number;
  finished_at: number | null;
}

interface MigrationRow {
  version: number;
}

/* ------------------------------------------------------------------ */
/*  SqliteStore                                                        */
/* ------------------------------------------------------------------ */

export class SqliteStore {
  readonly databasePath: string;
  readonly maxSessions: number;
  readonly maxMessagesInMemory: number;
  #db: Database | null = null;

  constructor(options: SqliteStoreOptions = {}) {
    this.databasePath = options.databasePath ?? DEFAULT_DATABASE_PATH;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxMessagesInMemory =
      options.maxMessagesInMemory ?? DEFAULT_MAX_MESSAGES_IN_MEMORY;
  }

  /* ======================== Connection ======================== */

  connect(): Database {
    if (this.#db) return this.#db;

    this.#db = new Database(this.databasePath);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');

    this.#runMigrations();

    return this.#db;
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }

  /** Expose the underlying database for advanced use / tests. */
  get db(): Database {
    if (!this.#db) throw new Error('SqliteStore is not connected');
    return this.#db;
  }

  /* ======================== Migrations ======================== */

  #runMigrations(): void {
    const db = this.#db!;

    // Ensure _migrations table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);

    const currentVersion = this.#getCurrentVersion();
    const migrations = this.#loadMigrationFiles();

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;

      const tx = db.transaction(() => {
        db.exec(migration.sql);
        db.run(
          'INSERT INTO _migrations (version, applied_at) VALUES (?, ?)',
          [migration.version, Math.floor(Date.now() / 1000)],
        );
      });
      tx();
    }
  }

  #getCurrentVersion(): number {
    const db = this.#db!;
    const row = db
      .query('SELECT MAX(version) as version FROM _migrations')
      .get() as MigrationRow | null;
    return row?.version ?? 0;
  }

  #loadMigrationFiles(): Array<{ version: number; sql: string }> {
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
    let files: string[];
    try {
      files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    } catch {
      return [];
    }

    return files.map((f) => {
      const version = Number.parseInt(f.split('_')[0]!, 10);
      const sql = readFileSync(join(migrationsDir, f), 'utf-8');
      return { version, sql };
    });
  }

  getMigrationVersion(): number {
    this.#ensureConnected();
    return this.#getCurrentVersion();
  }

  /* ======================== Sessions ======================== */

  createSession(session: {
    id: string;
    name: string;
    cwd: string;
    status?: SessionStatus;
    tags?: string[];
    config?: Record<string, unknown>;
    idleTimeoutMs?: number;
  }): void {
    this.#ensureConnected();
    const now = Math.floor(Date.now() / 1000);
    this.#db!.run(
      `INSERT INTO sessions (id, name, status, cwd, tags, config, created_at, updated_at, idle_timeout_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.name,
        session.status ?? 'active',
        session.cwd,
        JSON.stringify(session.tags ?? []),
        JSON.stringify(session.config ?? {}),
        now,
        now,
        session.idleTimeoutMs ?? 1800000,
      ],
    );
  }

  getSession(sessionId: string): SessionMeta | null {
    this.#ensureConnected();
    const row = this.#db!
      .query('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as SessionRow | null;
    return row ? this.#toSessionMeta(row) : null;
  }

  listSessions(statusFilter?: SessionStatus): SessionMeta[] {
    this.#ensureConnected();
    let rows: SessionRow[];
    if (statusFilter) {
      rows = this.#db!
        .query('SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC')
        .all(statusFilter) as SessionRow[];
    } else {
      rows = this.#db!
        .query('SELECT * FROM sessions ORDER BY updated_at DESC')
        .all() as SessionRow[];
    }
    return rows.map((r) => this.#toSessionMeta(r));
  }

  updateSession(
    sessionId: string,
    updates: Partial<{
      name: string;
      status: SessionStatus;
      cwd: string;
      tags: string[];
      config: Record<string, unknown>;
    }>,
  ): void {
    this.#ensureConnected();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.cwd !== undefined) {
      setClauses.push('cwd = ?');
      values.push(updates.cwd);
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.config !== undefined) {
      setClauses.push('config = ?');
      values.push(JSON.stringify(updates.config));
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(sessionId);

    this.#db!.run(
      `UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    );
  }

  archiveSession(sessionId: string): void {
    this.updateSession(sessionId, { status: 'archived' });
  }

  getSessionCount(statusFilter?: SessionStatus): number {
    this.#ensureConnected();
    if (statusFilter) {
      const row = this.#db!
        .query('SELECT COUNT(*) as count FROM sessions WHERE status = ?')
        .get(statusFilter) as { count: number };
      return row.count;
    }
    const row = this.#db!
      .query("SELECT COUNT(*) as count FROM sessions WHERE status != 'archived'")
      .get() as { count: number };
    return row.count;
  }

  /* ======================== Messages ======================== */

  addMessage(sessionId: string, message: Message): void {
    this.#ensureConnected();
    // Determine next seq for this session
    const maxSeq = this.#db!
      .query('SELECT COALESCE(MAX(seq), 0) as maxSeq FROM messages WHERE session_id = ?')
      .get(sessionId) as { maxSeq: number };
    const seq = maxSeq.maxSeq + 1;

    this.#db!.run(
      `INSERT INTO messages (id, session_id, role, content, created_at, seq)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        sessionId,
        message.role,
        JSON.stringify(message.content),
        message.createdAt,
        seq,
      ],
    );
  }

  listMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Message[] {
    this.#ensureConnected();
    const limit = options?.limit ?? this.maxMessagesInMemory;
    const offset = options?.offset ?? 0;

    const rows = this.#db!
      .query(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?',
      )
      .all(sessionId, limit, offset) as MessageRow[];

    return rows.map((r) => this.#toMessage(r));
  }

  getMessage(messageId: string): Message | null {
    this.#ensureConnected();
    const row = this.#db!
      .query('SELECT * FROM messages WHERE id = ?')
      .get(messageId) as MessageRow | null;
    return row ? this.#toMessage(row) : null;
  }

  /* ======================== Tasks ======================== */

  createTask(task: {
    id: string;
    sessionId: string;
    description: string;
    status?: Task['status'];
    assignee?: string;
  }): void {
    this.#ensureConnected();
    const now = Math.floor(Date.now() / 1000);
    this.#db!.run(
      `INSERT INTO tasks (id, session_id, description, status, assignee, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.sessionId,
        task.description,
        task.status ?? 'pending',
        task.assignee ?? null,
        now,
        now,
      ],
    );
  }

  getTask(taskId: string): Task | null {
    this.#ensureConnected();
    const row = this.#db!
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow | null;
    return row ? this.#toTask(row) : null;
  }

  listTasksBySession(sessionId: string): Task[] {
    this.#ensureConnected();
    const rows = this.#db!
      .query('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as TaskRow[];
    return rows.map((r) => this.#toTask(r));
  }

  updateTask(
    taskId: string,
    updates: Partial<{
      description: string;
      status: Task['status'];
      assignee: string | null;
    }>,
  ): void {
    this.#ensureConnected();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.assignee !== undefined) {
      setClauses.push('assignee = ?');
      values.push(updates.assignee);
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(taskId);

    this.#db!.run(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    );
  }

  /* ======================== Favorites ======================== */

  addFavorite(favorite: {
    id: string;
    sessionId?: string | null;
    messageId?: string | null;
  }): void {
    this.#ensureConnected();
    const now = Math.floor(Date.now() / 1000);
    this.#db!.run(
      `INSERT INTO favorites (id, session_id, message_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [favorite.id, favorite.sessionId ?? null, favorite.messageId ?? null, now],
    );
  }

  removeFavorite(favoriteId: string): void {
    this.#ensureConnected();
    this.#db!.run('DELETE FROM favorites WHERE id = ?', [favoriteId]);
  }

  listFavorites(sessionId?: string): Favorite[] {
    this.#ensureConnected();
    let rows: FavoriteRow[];
    if (sessionId) {
      rows = this.#db!
        .query('SELECT * FROM favorites WHERE session_id = ? ORDER BY created_at DESC')
        .all(sessionId) as FavoriteRow[];
    } else {
      rows = this.#db!
        .query('SELECT * FROM favorites ORDER BY created_at DESC')
        .all() as FavoriteRow[];
    }
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      messageId: r.message_id,
      createdAt: r.created_at,
    }));
  }

  /* ======================== Tool Executions ======================== */

  createToolExecution(exec: {
    id: string;
    sessionId: string;
    toolName: string;
    params?: Record<string, unknown>;
    status?: ToolExecution['status'];
  }): void {
    this.#ensureConnected();
    const now = Math.floor(Date.now() / 1000);
    this.#db!.run(
      `INSERT INTO tool_executions (id, session_id, tool_name, params, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        exec.id,
        exec.sessionId,
        exec.toolName,
        JSON.stringify(exec.params ?? {}),
        exec.status ?? 'running',
        now,
      ],
    );
  }

  updateToolExecution(
    execId: string,
    updates: Partial<{
      status: ToolExecution['status'];
      result: string | null;
      finishedAt: number;
    }>,
  ): void {
    this.#ensureConnected();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.result !== undefined) {
      setClauses.push('result = ?');
      values.push(updates.result);
    }
    if (updates.finishedAt !== undefined) {
      setClauses.push('finished_at = ?');
      values.push(updates.finishedAt);
    }

    if (setClauses.length === 0) return;
    values.push(execId);

    this.#db!.run(
      `UPDATE tool_executions SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    );
  }

  listToolExecutions(sessionId: string): ToolExecution[] {
    this.#ensureConnected();
    const rows = this.#db!
      .query(
        'SELECT * FROM tool_executions WHERE session_id = ? ORDER BY started_at DESC',
      )
      .all(sessionId) as ToolExecutionRow[];
    return rows.map((r) => this.#toToolExecution(r));
  }

  /* ======================== History Search ======================== */

  searchHistory(
    query: string,
    _scope: 'session' | 'all' = 'all',
    limit = 20,
  ): HistorySearchResult[] {
    this.#ensureConnected();
    const pattern = `%${query}%`;
    const rows = this.#db!
      .query(
        `SELECT m.id as message_id, m.session_id, m.role, m.content, m.created_at,
                s.name as session_name
         FROM messages m
         JOIN sessions s ON m.session_id = s.id
         WHERE m.content LIKE ?
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(pattern, limit) as Array<{
      message_id: string;
      session_id: string;
      role: string;
      content: string;
      created_at: number;
      session_name: string;
    }>;

    return rows.map((r) => {
      // Extract a text snippet from the content JSON
      let snippet = '';
      try {
        const blocks = JSON.parse(r.content) as MessageContentBlock[];
        const textBlock = blocks.find((b) => b.type === 'text');
        if (textBlock && 'text' in textBlock) {
          snippet = textBlock.text.slice(0, 200);
        }
      } catch {
        snippet = r.content.slice(0, 200);
      }

      return {
        sessionId: r.session_id,
        sessionName: r.session_name,
        messageId: r.message_id,
        role: r.role as 'user' | 'assistant',
        snippet,
        timestamp: r.created_at,
      };
    });
  }

  /* ======================== Legacy compat ======================== */

  /** Legacy method for backward compatibility. */
  saveSession(_session: Session): void {
    // In the new design, individual CRUD methods are used instead.
  }

  /** Legacy method. Delegates to addMessage. */
  appendMessage(sessionId: string, message: Message): void {
    this.addMessage(sessionId, message);
  }

  /** Legacy method. Replaces all tasks for a session. */
  replaceTasks(sessionId: string, tasks: Task[]): void {
    this.#ensureConnected();
    const tx = this.#db!.transaction(() => {
      this.#db!.run('DELETE FROM tasks WHERE session_id = ?', [sessionId]);
      for (const task of tasks) {
        this.createTask({
          id: task.id,
          sessionId,
          description: task.description,
          status: task.status,
          assignee: undefined,
        });
      }
    });
    tx();
  }

  /* ======================== Helpers ======================== */

  #ensureConnected(): void {
    if (!this.#db) {
      this.connect();
    }
  }

  #toSessionMeta(row: SessionRow): SessionMeta {
    return {
      id: row.id,
      name: row.name,
      cwd: row.cwd,
      status: row.status as SessionStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      clientCount: 0,
      hasActiveWriter: false,
    };
  }

  #toMessage(row: MessageRow): Message {
    let content: MessageContentBlock[];
    try {
      content = JSON.parse(row.content) as MessageContentBlock[];
    } catch {
      content = [{ type: 'text', text: row.content }];
    }

    return {
      id: row.id,
      role: row.role as Message['role'],
      content,
      createdAt: row.created_at,
      updatedAt: row.created_at,
    };
  }

  #toTask(row: TaskRow): Task {
    return {
      id: row.id,
      sessionId: row.session_id,
      subject: '',
      description: row.description,
      status: row.status as Task['status'],
      activeForm: undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  #toToolExecution(row: ToolExecutionRow): ToolExecution {
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(row.params) as Record<string, unknown>;
    } catch {
      params = {};
    }
    return {
      id: row.id,
      sessionId: row.session_id,
      toolName: row.tool_name,
      params,
      status: row.status as ToolExecution['status'],
      result: row.result,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }
}

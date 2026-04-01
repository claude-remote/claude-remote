import Database from 'better-sqlite3';

import type {
  HistorySearchResult,
  Message,
  Session,
  SessionMeta,
  Task,
} from '@/shared/types';
import {
  DEFAULT_DATABASE_PATH,
  DEFAULT_MAX_MESSAGES_IN_MEMORY,
  DEFAULT_MAX_SESSIONS,
} from '@/shared/constants';

export interface SqliteStoreOptions {
  databasePath?: string;
  maxSessions?: number;
  maxMessagesInMemory?: number;
}

export class SqliteStore {
  readonly databasePath: string;
  readonly maxSessions: number;
  readonly maxMessagesInMemory: number;
  #db: Database.Database | null = null;

  constructor(options: SqliteStoreOptions = {}) {
    this.databasePath = options.databasePath ?? DEFAULT_DATABASE_PATH;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxMessagesInMemory = options.maxMessagesInMemory ?? DEFAULT_MAX_MESSAGES_IN_MEMORY;
  }

  connect(): Database.Database {
    // TODO(T01): open SQLite database, apply schema, and enable WAL mode.
    if (!this.#db) {
      this.#db = new Database(':memory:');
    }

    return this.#db;
  }

  listSessions(): SessionMeta[] {
    // TODO(T01): implement session listing with resource limit awareness.
    return [];
  }

  getSession(_sessionId: string): Session | null {
    // TODO(T01): load a session snapshot from SQLite, including messages and tasks.
    return null;
  }

  saveSession(_session: Session): void {
    // TODO(T01): implement session CRUD and transactional persistence.
  }

  appendMessage(_sessionId: string, _message: Message): void {
    // TODO(T01): persist completed assistant/result/tool_result messages.
  }

  replaceTasks(_sessionId: string, _tasks: Task[]): void {
    // TODO(T01): persist task state transitions and active_form updates.
  }

  searchHistory(_query: string, _scope: 'session' | 'all', _limit = 20): HistorySearchResult[] {
    // TODO(T01): implement full-text or LIKE-based history search.
    return [];
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }
}

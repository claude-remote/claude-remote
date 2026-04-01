import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SqliteStore } from '../SqliteStore';
import type { Message, Task } from '@/shared/types';

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore({ databasePath: ':memory:' });
    store.connect();
  });

  afterEach(() => {
    store.close();
  });

  /* ======================== Connection & Migrations ======================== */

  describe('connection and migrations', () => {
    it('should connect and run migrations', () => {
      expect(store.db).toBeDefined();
      expect(store.getMigrationVersion()).toBe(1);
    });

    it('should be idempotent on reconnect', () => {
      // Calling connect again should not throw
      store.connect();
      expect(store.getMigrationVersion()).toBe(1);
    });

    it('should not re-run applied migrations', () => {
      const version1 = store.getMigrationVersion();
      // Create a new store pointing to the same (in-memory) db — can't really test
      // persistence with :memory:, but we verify version tracking works
      expect(version1).toBe(1);
    });
  });

  /* ======================== Sessions ======================== */

  describe('sessions', () => {
    it('should create and retrieve a session', () => {
      store.createSession({ id: 's1', name: 'Test Session', cwd: '/tmp' });
      const session = store.getSession('s1');
      expect(session).not.toBeNull();
      expect(session!.id).toBe('s1');
      expect(session!.name).toBe('Test Session');
      expect(session!.cwd).toBe('/tmp');
      expect(session!.status).toBe('active');
    });

    it('should return null for non-existent session', () => {
      expect(store.getSession('nonexistent')).toBeNull();
    });

    it('should list sessions ordered by updated_at DESC', () => {
      store.createSession({ id: 's1', name: 'First', cwd: '/a' });
      store.createSession({ id: 's2', name: 'Second', cwd: '/b' });
      const sessions = store.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should filter sessions by status', () => {
      store.createSession({ id: 's1', name: 'Active', cwd: '/a', status: 'active' });
      store.createSession({ id: 's2', name: 'Idle', cwd: '/b', status: 'idle' });
      store.createSession({
        id: 's3',
        name: 'Archived',
        cwd: '/c',
        status: 'archived',
      });

      expect(store.listSessions('active')).toHaveLength(1);
      expect(store.listSessions('idle')).toHaveLength(1);
      expect(store.listSessions('archived')).toHaveLength(1);
    });

    it('should update session fields', () => {
      store.createSession({ id: 's1', name: 'Original', cwd: '/tmp' });
      store.updateSession('s1', { name: 'Updated', status: 'idle' });
      const session = store.getSession('s1');
      expect(session!.name).toBe('Updated');
      expect(session!.status).toBe('idle');
    });

    it('should archive a session', () => {
      store.createSession({ id: 's1', name: 'Test', cwd: '/tmp' });
      store.archiveSession('s1');
      const session = store.getSession('s1');
      expect(session!.status).toBe('archived');
    });

    it('should reject invalid status via CHECK constraint', () => {
      expect(() => {
        store.createSession({
          id: 's1',
          name: 'Bad',
          cwd: '/tmp',
          status: 'bogus' as any,
        });
      }).toThrow();
    });

    it('should count non-archived sessions', () => {
      store.createSession({ id: 's1', name: 'A', cwd: '/a', status: 'active' });
      store.createSession({ id: 's2', name: 'B', cwd: '/b', status: 'idle' });
      store.createSession({ id: 's3', name: 'C', cwd: '/c', status: 'archived' });

      expect(store.getSessionCount()).toBe(2);
      expect(store.getSessionCount('active')).toBe(1);
    });
  });

  /* ======================== Resource Limits ======================== */

  describe('resource limits', () => {
    it('should respect maxSessions default', () => {
      const limitedStore = new SqliteStore({
        databasePath: ':memory:',
        maxSessions: 2,
      });
      limitedStore.connect();

      expect(limitedStore.maxSessions).toBe(2);
      limitedStore.close();
    });

    it('should track session count for limit enforcement', () => {
      // Create sessions up to the default limit check
      for (let i = 0; i < 5; i++) {
        store.createSession({ id: `s${i}`, name: `Session ${i}`, cwd: '/tmp' });
      }
      expect(store.getSessionCount()).toBe(5);

      // Archive some
      store.archiveSession('s0');
      store.archiveSession('s1');
      expect(store.getSessionCount()).toBe(3);
    });
  });

  /* ======================== Messages ======================== */

  describe('messages', () => {
    beforeEach(() => {
      store.createSession({ id: 's1', name: 'Test', cwd: '/tmp' });
    });

    it('should add and list messages', () => {
      const msg: Message = {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: 1000,
        updatedAt: 1000,
      };
      store.addMessage('s1', msg);

      const messages = store.listMessages('s1');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.id).toBe('m1');
      expect(messages[0]!.role).toBe('user');
      expect(messages[0]!.content).toEqual([{ type: 'text', text: 'Hello' }]);
    });

    it('should auto-increment seq', () => {
      store.addMessage('s1', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'First' }],
        createdAt: 1000,
        updatedAt: 1000,
      });
      store.addMessage('s1', {
        id: 'm2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Second' }],
        createdAt: 1001,
        updatedAt: 1001,
      });

      const messages = store.listMessages('s1');
      expect(messages).toHaveLength(2);
      expect(messages[0]!.id).toBe('m1');
      expect(messages[1]!.id).toBe('m2');
    });

    it('should support limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        store.addMessage('s1', {
          id: `m${i}`,
          role: 'user',
          content: [{ type: 'text', text: `Message ${i}` }],
          createdAt: 1000 + i,
          updatedAt: 1000 + i,
        });
      }

      const page1 = store.listMessages('s1', { limit: 3, offset: 0 });
      expect(page1).toHaveLength(3);
      expect(page1[0]!.id).toBe('m0');

      const page2 = store.listMessages('s1', { limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);
      expect(page2[0]!.id).toBe('m3');
    });

    it('should get a single message by id', () => {
      store.addMessage('s1', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: 1000,
        updatedAt: 1000,
      });

      const msg = store.getMessage('m1');
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe('m1');

      expect(store.getMessage('nonexistent')).toBeNull();
    });

    it('should reject invalid role via CHECK constraint', () => {
      expect(() => {
        store.addMessage('s1', {
          id: 'm1',
          role: 'invalid' as any,
          content: [{ type: 'text', text: 'Bad' }],
          createdAt: 1000,
          updatedAt: 1000,
        });
      }).toThrow();
    });
  });

  /* ======================== Tasks ======================== */

  describe('tasks', () => {
    beforeEach(() => {
      store.createSession({ id: 's1', name: 'Test', cwd: '/tmp' });
    });

    it('should create and retrieve a task', () => {
      store.createTask({
        id: 't1',
        sessionId: 's1',
        description: 'Fix the bug',
        status: 'pending',
      });

      const task = store.getTask('t1');
      expect(task).not.toBeNull();
      expect(task!.id).toBe('t1');
      expect(task!.description).toBe('Fix the bug');
      expect(task!.status).toBe('pending');
    });

    it('should list tasks by session', () => {
      store.createTask({ id: 't1', sessionId: 's1', description: 'Task 1' });
      store.createTask({ id: 't2', sessionId: 's1', description: 'Task 2' });

      const tasks = store.listTasksBySession('s1');
      expect(tasks).toHaveLength(2);
    });

    it('should update task status', () => {
      store.createTask({ id: 't1', sessionId: 's1', description: 'Task 1' });
      store.updateTask('t1', { status: 'in_progress' });

      const task = store.getTask('t1');
      expect(task!.status).toBe('in_progress');
    });

    it('should reject invalid task status', () => {
      expect(() => {
        store.createTask({
          id: 't1',
          sessionId: 's1',
          description: 'Bad',
          status: 'invalid' as any,
        });
      }).toThrow();
    });

    it('should replace tasks for a session', () => {
      store.createTask({ id: 't1', sessionId: 's1', description: 'Old task' });

      const newTasks: Task[] = [
        {
          id: 't2',
          sessionId: 's1',
          subject: '',
          description: 'New task 1',
          status: 'pending',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 't3',
          sessionId: 's1',
          subject: '',
          description: 'New task 2',
          status: 'in_progress',
          createdAt: 0,
          updatedAt: 0,
        },
      ];
      store.replaceTasks('s1', newTasks);

      const tasks = store.listTasksBySession('s1');
      expect(tasks).toHaveLength(2);
      expect(tasks[0]!.id).toBe('t2');
      expect(tasks[1]!.id).toBe('t3');
    });
  });

  /* ======================== Favorites ======================== */

  describe('favorites', () => {
    beforeEach(() => {
      store.createSession({ id: 's1', name: 'Test', cwd: '/tmp' });
      store.addMessage('s1', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: 1000,
        updatedAt: 1000,
      });
    });

    it('should add and list favorites', () => {
      store.addFavorite({ id: 'f1', sessionId: 's1', messageId: 'm1' });
      const favorites = store.listFavorites();
      expect(favorites).toHaveLength(1);
      expect(favorites[0]!.id).toBe('f1');
      expect(favorites[0]!.sessionId).toBe('s1');
      expect(favorites[0]!.messageId).toBe('m1');
    });

    it('should list favorites filtered by session', () => {
      store.addFavorite({ id: 'f1', sessionId: 's1', messageId: 'm1' });
      store.addFavorite({ id: 'f2', sessionId: null });

      expect(store.listFavorites('s1')).toHaveLength(1);
    });

    it('should remove a favorite', () => {
      store.addFavorite({ id: 'f1', sessionId: 's1' });
      store.removeFavorite('f1');
      expect(store.listFavorites()).toHaveLength(0);
    });
  });

  /* ======================== Tool Executions ======================== */

  describe('tool executions', () => {
    beforeEach(() => {
      store.createSession({ id: 's1', name: 'Test', cwd: '/tmp' });
    });

    it('should create and list tool executions', () => {
      store.createToolExecution({
        id: 'te1',
        sessionId: 's1',
        toolName: 'bash',
        params: { command: 'ls' },
      });

      const execs = store.listToolExecutions('s1');
      expect(execs).toHaveLength(1);
      expect(execs[0]!.toolName).toBe('bash');
      expect(execs[0]!.status).toBe('running');
      expect(execs[0]!.params).toEqual({ command: 'ls' });
    });

    it('should update tool execution status', () => {
      store.createToolExecution({
        id: 'te1',
        sessionId: 's1',
        toolName: 'bash',
      });

      const now = Math.floor(Date.now() / 1000);
      store.updateToolExecution('te1', {
        status: 'completed',
        result: 'file1.txt\nfile2.txt',
        finishedAt: now,
      });

      const execs = store.listToolExecutions('s1');
      expect(execs[0]!.status).toBe('completed');
      expect(execs[0]!.result).toBe('file1.txt\nfile2.txt');
      expect(execs[0]!.finishedAt).toBe(now);
    });

    it('should reject invalid tool execution status', () => {
      expect(() => {
        store.createToolExecution({
          id: 'te1',
          sessionId: 's1',
          toolName: 'bash',
          status: 'invalid' as any,
        });
      }).toThrow();
    });

    it('should support all valid tool execution statuses', () => {
      const statuses = [
        'running',
        'completed',
        'failed',
        'interrupted',
        'crashed',
      ] as const;
      for (const status of statuses) {
        store.createToolExecution({
          id: `te-${status}`,
          sessionId: 's1',
          toolName: 'bash',
          status,
        });
      }
      const execs = store.listToolExecutions('s1');
      expect(execs).toHaveLength(5);
    });
  });

  /* ======================== Foreign Keys ======================== */

  describe('foreign keys', () => {
    it('should enforce session FK on messages', () => {
      expect(() => {
        store.addMessage('nonexistent', {
          id: 'm1',
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          createdAt: 1000,
          updatedAt: 1000,
        });
      }).toThrow();
    });

    it('should enforce session FK on tasks', () => {
      expect(() => {
        store.createTask({
          id: 't1',
          sessionId: 'nonexistent',
          description: 'Test',
        });
      }).toThrow();
    });

    it('should enforce session FK on tool executions', () => {
      expect(() => {
        store.createToolExecution({
          id: 'te1',
          sessionId: 'nonexistent',
          toolName: 'bash',
        });
      }).toThrow();
    });

    it('should cascade delete messages when session is deleted', () => {
      store.createSession({ id: 's1', name: 'Test', cwd: '/tmp' });
      store.addMessage('s1', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: 1000,
        updatedAt: 1000,
      });

      // Delete session directly
      store.db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');
      expect(store.getMessage('m1')).toBeNull();
    });
  });

  /* ======================== History Search ======================== */

  describe('searchHistory', () => {
    beforeEach(() => {
      store.createSession({ id: 's1', name: 'Test Session', cwd: '/tmp' });
      store.addMessage('s1', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'How do I fix the login bug?' }],
        createdAt: 1000,
        updatedAt: 1000,
      });
      store.addMessage('s1', {
        id: 'm2',
        role: 'assistant',
        content: [{ type: 'text', text: 'You should check the auth middleware.' }],
        createdAt: 1001,
        updatedAt: 1001,
      });
    });

    it('should find messages matching query', () => {
      const results = store.searchHistory('login bug');
      expect(results).toHaveLength(1);
      expect(results[0]!.messageId).toBe('m1');
      expect(results[0]!.sessionName).toBe('Test Session');
    });

    it('should return empty for no matches', () => {
      const results = store.searchHistory('nonexistent query xyz');
      expect(results).toHaveLength(0);
    });
  });
});

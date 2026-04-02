import { randomUUID } from 'node:crypto';
import type { Message } from '@/shared/types';
import type { HubClientInfo, Session } from './HubProtocol.js';

type CreateSessionInput = {
  cwd: string;
  name?: string;
};

export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();

  createSession(input: CreateSessionInput): Session {
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      name: input.name ?? 'Untitled session',
      cwd: input.cwd,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      clients: [],
      messages: [],
      tasks: [],
      pendingPermissions: [],
      tags: [],
    };

    this.sessions.set(session.id, session);
    return session;
  }

  listSessions(): Session[] {
    return [...this.sessions.values()];
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  archiveSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const archivedSession: Session = {
      ...session,
      status: 'archived',
      updatedAt: Date.now(),
    };
    this.sessions.set(sessionId, archivedSession);
    return archivedSession;
  }

  updateSession(
    sessionId: string,
    updates: {
      name?: string;
      tags?: string[];
    },
  ): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const updatedSession: Session = {
      ...session,
      name: updates.name ?? session.name,
      tags: updates.tags ?? session.tags ?? [],
      updatedAt: Date.now(),
    };
    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  appendMessage(sessionId: string, message: Message): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const updatedSession: Session = {
      ...session,
      messages: [...session.messages, message],
      updatedAt: Date.now(),
    };
    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  attachClient(sessionId: string, client: HubClientInfo): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const attachedSession: Session = {
      ...session,
      status: 'active',
      updatedAt: Date.now(),
      clients: [...session.clients, client],
    };

    this.sessions.set(sessionId, attachedSession);
    return attachedSession;
  }
}

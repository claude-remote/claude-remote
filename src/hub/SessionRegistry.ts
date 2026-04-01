import { randomUUID } from 'crypto'
import type { HubClientInfo, Session } from './HubProtocol.js'

type CreateSessionInput = {
  cwd: string
  name?: string
}

export class SessionRegistry {
  private readonly sessions = new Map<string, Session>()

  createSession(input: CreateSessionInput): Session {
    const now = Date.now()
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
    }

    this.sessions.set(session.id, session)
    return session
  }

  listSessions(): Session[] {
    return [...this.sessions.values()]
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)
  }

  attachClient(sessionId: string, client: HubClientInfo): Session | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return undefined
    }

    const attachedSession: Session = {
      ...session,
      status: 'active',
      updatedAt: Date.now(),
      clients: [...session.clients, client],
    }

    this.sessions.set(sessionId, attachedSession)
    return attachedSession
  }
}

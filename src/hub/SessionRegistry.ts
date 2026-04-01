import { randomUUID } from 'crypto'
import type { Session } from './HubProtocol.js'

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
}

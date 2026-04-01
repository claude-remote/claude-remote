import { describe, expect, test } from 'bun:test'
import { SessionRegistry } from './SessionRegistry.js'

describe('SessionRegistry', () => {
  test('creates and lists a default in-memory session', () => {
    const registry = new SessionRegistry()
    const session = registry.createSession({
      cwd: '/tmp/project',
      name: 'test session',
    })

    expect(session.cwd).toBe('/tmp/project')
    expect(registry.listSessions()).toHaveLength(1)
  })
})

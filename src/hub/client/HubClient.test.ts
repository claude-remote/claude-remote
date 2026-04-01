import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { Hub } from '../Hub.js'
import { HubClient } from './HubClient.js'

const socketPath = join(tmpdir(), `claude-remote-client-${process.pid}.sock`)

let hub: Hub | null = null
let client: HubClient | null = null

afterEach(async () => {
  await client?.disconnect()
  await hub?.stop()
  client = null
  hub = null
})

describe('HubClient', () => {
  test('starts disconnected before connect is called', () => {
    client = new HubClient({ socketPath })
    expect(client.getConnectionState()).toBe('disconnected')
  })

  test('connects to a running local hub and can create a session', async () => {
    hub = new Hub({ socketPath })
    await hub.start()

    client = new HubClient({ socketPath })
    await client.connect()

    const session = await client.createSession({
      cwd: '/tmp/project',
      name: 'test session',
    })

    expect(client.getConnectionState()).toBe('connected')
    expect(session.cwd).toBe('/tmp/project')
    expect(session.name).toBe('test session')
  })
})

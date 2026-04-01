import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Hub } from './Hub.js'

const socketPath = join(tmpdir(), `claude-remote-hub-${process.pid}.sock`)

afterEach(async () => {
  if (existsSync(socketPath)) {
    await rm(socketPath, { force: true })
  }
})

describe('Hub', () => {
  test('reports running status after start', async () => {
    const hub = new Hub({ socketPath })
    await hub.start()

    expect(hub.getStatus().running).toBe(true)

    await hub.stop()
  })
})

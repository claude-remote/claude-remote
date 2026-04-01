import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { LocalSocketServer } from './LocalSocketServer.js'

const socketPath = join(tmpdir(), `claude-remote-test-${process.pid}.sock`)

afterEach(async () => {
  if (existsSync(socketPath)) {
    await rm(socketPath, { force: true })
  }
})

describe('LocalSocketServer', () => {
  test('starts on a unix socket path', async () => {
    const server = new LocalSocketServer(socketPath)
    await server.start()

    expect(server.address()).toBe(socketPath)

    await server.stop()
  })
})

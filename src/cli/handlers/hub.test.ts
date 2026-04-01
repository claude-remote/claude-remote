import { describe, expect, test } from 'bun:test'
import { formatHubStatus } from './hub.js'

describe('hub handler formatting', () => {
  test('formats running status output', () => {
    const text = formatHubStatus({
      running: true,
      sessionCount: 2,
      connectionCount: 1,
      socketPath: '/tmp/hub.sock',
    })

    expect(text).toContain('running')
    expect(text).toContain('/tmp/hub.sock')
  })
})

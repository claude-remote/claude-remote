import { describe, expect, test } from 'bun:test'
import { ensureHubSessionName } from './hubAttach.js'

describe('hub attach helpers', () => {
  test('uses current cwd as default session metadata input', () => {
    const info = ensureHubSessionName('/tmp/project')
    expect(info.cwd).toBe('/tmp/project')
    expect(info.name).toBe('project')
  })
})

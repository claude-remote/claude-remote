import { describe, expect, test } from 'bun:test'
import { resolveLocalHubCommand } from './localHubCli.js'

describe('local hub cli', () => {
  test('recognizes local hub fast-path commands', () => {
    expect(resolveLocalHubCommand(['serve'])).toBe('serve')
    expect(resolveLocalHubCommand(['status'])).toBe('status')
    expect(resolveLocalHubCommand(['attach'])).toBe(null)
    expect(resolveLocalHubCommand(['--version'])).toBe(null)
  })
})

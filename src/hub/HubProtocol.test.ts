import { describe, expect, test } from 'bun:test'
import {
  createNotImplementedChatError,
  isHubResponse,
} from './HubProtocol.js'

describe('HubProtocol', () => {
  test('builds a structured not_implemented chat error', () => {
    const response = createNotImplementedChatError('cmd-1')

    expect(isHubResponse(response)).toBe(true)
    expect(response).toMatchObject({
      type: 'error',
      cmdId: 'cmd-1',
      code: 'not_implemented',
    })
  })
})

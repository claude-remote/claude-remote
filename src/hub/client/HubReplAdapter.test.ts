import { describe, expect, test } from 'bun:test'
import { mapHubChatErrorToNotice } from './HubReplAdapter.js'

describe('HubReplAdapter', () => {
  test('maps not_implemented chat errors to a user-facing notice', () => {
    expect(
      mapHubChatErrorToNotice({
        type: 'error',
        cmdId: '1',
        code: 'not_implemented',
        error: 'chat is not implemented in Local Hub Baseline',
      }),
    ).toContain('not implemented')
  })
})

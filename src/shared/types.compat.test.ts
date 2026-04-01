import { describe, expect, test } from 'bun:test'

import type {
  ConfigOptions,
  ContextUsage,
  CostSummary,
  HistorySearchResult,
  SessionConfig,
  SessionMeta,
} from './types.js'

describe('shared type compatibility', () => {
  test('retains the camelCase contract used by the web scaffold', () => {
    const session: SessionMeta = {
      id: 'session-1',
      name: 'Main session',
      cwd: '/workspace',
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
      clientCount: 1,
      hasActiveWriter: true,
    }

    const config: SessionConfig = {
      model: 'claude-sonnet',
      effortLevel: 'medium',
      permissionMode: 'ask',
    }

    const options: ConfigOptions = {
      availableModels: [{ id: 'claude-sonnet', name: 'Claude Sonnet', supportsImages: true }],
      effortLevels: ['low', 'medium', 'high'],
      permissionModes: ['ask', 'approve', 'bypass'],
    }

    const usage: ContextUsage = {
      usedTokens: 10,
      maxTokens: 100,
      percentage: 10,
      breakdown: [{ label: 'messages', tokens: 10 }],
    }

    const cost: CostSummary = {
      sessionCost: 0,
      formattedCost: '$0.00',
      inputTokens: 0,
      outputTokens: 0,
      apiCalls: 0,
      sessionDuration: 0,
    }

    const result: HistorySearchResult = {
      sessionId: 'session-1',
      sessionName: 'Main session',
      messageId: 'message-1',
      role: 'user',
      snippet: 'hello',
      timestamp: 123,
    }

    expect(session.createdAt).toBe(1)
    expect(config.effortLevel).toBe('medium')
    expect(options.availableModels).toHaveLength(1)
    expect(usage.usedTokens).toBe(10)
    expect(cost.sessionCost).toBe(0)
    expect(result.messageId).toBe('message-1')
  })
})

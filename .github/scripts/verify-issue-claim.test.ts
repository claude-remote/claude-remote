import { describe, expect, test } from 'bun:test'

import {
  extractIssueNumber,
  validateClaim,
} from './verify-issue-claim.mjs'

describe('verify issue claim helpers', () => {
  test('extracts linked issue number from PR body keywords first', () => {
    expect(
      extractIssueNumber({
        body: 'Implements the flow.\n\nCloses #12',
        headRefName: 'feat/task-13-sessions-page',
      }),
    ).toEqual({ issueNumber: 12, source: 'body' })
  })

  test('falls back to task number in branch name', () => {
    expect(
      extractIssueNumber({
        body: 'No explicit issue link yet',
        headRefName: 'feat/task-8-shared-types',
      }),
    ).toEqual({ issueNumber: 8, source: 'branch' })
  })

  test('rejects PRs without linked issue context', () => {
    expect(
      extractIssueNumber({
        body: 'Misc cleanup',
        headRefName: 'chore/misc-cleanup',
      }),
    ).toEqual({ issueNumber: null, source: 'missing' })
  })

  test('accepts claim when PR author is the issue assignee', () => {
    expect(
      validateClaim({
        issueNumber: 12,
        author: 'leo',
        assignees: ['leo'],
      }),
    ).toEqual({ ok: true })
  })

  test('rejects claim when issue is unassigned', () => {
    expect(
      validateClaim({
        issueNumber: 12,
        author: 'leo',
        assignees: [],
      }),
    ).toEqual({
      ok: false,
      reason:
        'Issue #12 is not claimed. Comment /claim on the issue before opening a PR.',
    })
  })

  test('rejects claim when issue belongs to someone else', () => {
    expect(
      validateClaim({
        issueNumber: 12,
        author: 'leo',
        assignees: ['alice'],
      }),
    ).toEqual({
      ok: false,
      reason:
        'Issue #12 is claimed by @alice, not @leo. Use /unclaim or coordinate before opening a PR.',
    })
  })
})

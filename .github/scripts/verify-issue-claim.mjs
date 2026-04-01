const ISSUE_KEYWORD_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i
const BRANCH_ISSUE_RE = /(?:^|\/)(?:feat\/task-|issue-)(\d+)(?:-|$)/i

export function extractIssueNumber({ body = '', headRefName = '' }) {
  const bodyMatch = ISSUE_KEYWORD_RE.exec(body)
  if (bodyMatch) {
    return {
      issueNumber: Number(bodyMatch[1]),
      source: 'body',
    }
  }

  const branchMatch = BRANCH_ISSUE_RE.exec(headRefName)
  if (branchMatch) {
    return {
      issueNumber: Number(branchMatch[1]),
      source: 'branch',
    }
  }

  return {
    issueNumber: null,
    source: 'missing',
  }
}

export function validateClaim({ issueNumber, author, assignees }) {
  if (!issueNumber) {
    return {
      ok: false,
      reason:
        'This PR is not linked to an issue. Link one issue in the PR body, or use a branch name like feat/task-12-... or issue-12-....',
    }
  }

  if (assignees.length === 0) {
    return {
      ok: false,
      reason: `Issue #${issueNumber} is not claimed. Comment /claim on the issue before opening a PR.`,
    }
  }

  if (assignees.includes(author)) {
    return { ok: true }
  }

  const owners = assignees.map(login => `@${login}`).join(', ')
  return {
    ok: false,
    reason: `Issue #${issueNumber} is claimed by ${owners}, not @${author}. Use /unclaim or coordinate before opening a PR.`,
  }
}

async function getIssue({ repo, issueNumber, token }) {
  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'claude-remote-claim-enforcement',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to load issue #${issueNumber}: ${response.status} ${body}`)
  }

  return response.json()
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const author = process.env.PR_AUTHOR
  const body = process.env.PR_BODY ?? ''
  const headRefName = process.env.PR_HEAD_REF ?? ''

  if (!token || !repo || !author) {
    throw new Error('Missing required environment: GITHUB_TOKEN, GITHUB_REPOSITORY, or PR_AUTHOR')
  }

  const extraction = extractIssueNumber({ body, headRefName })
  if (!extraction.issueNumber) {
    throw new Error(
      'This PR must be linked to exactly one issue via the PR body or task branch name, and that issue must be claimed with /claim first.',
    )
  }

  const issue = await getIssue({
    repo,
    issueNumber: extraction.issueNumber,
    token,
  })

  const result = validateClaim({
    issueNumber: extraction.issueNumber,
    author,
    assignees: Array.isArray(issue.assignees) ? issue.assignees.map(user => user.login) : [],
  })

  if (!result.ok) {
    throw new Error(result.reason)
  }

  console.log(
    `Claim check passed for issue #${extraction.issueNumber} (${extraction.source}) and PR author @${author}.`,
  )
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

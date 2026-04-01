import { describe, expect, it, beforeEach } from 'bun:test'
import {
  patchInteractiveEnv,
  verifyInteractiveEnv,
} from '../patchInteractiveEnv.js'

describe('patchInteractiveEnv', () => {
  // Save originals
  const origEnv = { ...process.env }

  beforeEach(() => {
    // Clean up env vars we set
    delete process.env.TERM
    delete process.env.TERM_PROGRAM
    delete process.env.COLORTERM
    delete process.env.COLUMNS
    delete process.env.LINES
    delete process.env.CLAUDE_INTERACTIVE
  })

  it('should set isTTY on stdout/stderr/stdin', () => {
    patchInteractiveEnv()
    expect(process.stdout.isTTY).toBe(true)
    expect(process.stderr.isTTY).toBe(true)
    expect(process.stdin.isTTY).toBe(true)
  })

  it('should set terminal environment variables', () => {
    patchInteractiveEnv()
    expect(process.env.TERM).toBe('xterm-256color')
    expect(process.env.TERM_PROGRAM).toBe('xterm')
    expect(process.env.COLORTERM).toBe('truecolor')
    expect(process.env.COLUMNS).toBe('120')
    expect(process.env.LINES).toBe('40')
  })

  it('should set CLAUDE_INTERACTIVE', () => {
    patchInteractiveEnv()
    expect(process.env.CLAUDE_INTERACTIVE).toBe('true')
  })

  it('should not overwrite existing env vars', () => {
    process.env.TERM = 'screen-256color'
    process.env.TERM_PROGRAM = 'tmux'
    patchInteractiveEnv()
    expect(process.env.TERM).toBe('screen-256color')
    expect(process.env.TERM_PROGRAM).toBe('tmux')
  })

  it('verifyInteractiveEnv should return ok:true after patch', () => {
    patchInteractiveEnv()
    const result = verifyInteractiveEnv()
    expect(result.ok).toBe(true)
    expect(result.details['stdout.isTTY']).toBe(true)
    expect(result.details['CLAUDE_INTERACTIVE']).toBe('true')
  })
})

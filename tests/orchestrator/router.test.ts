import { describe, it, expect } from 'bun:test'
import { parseRoute, isRouteError } from '../../src/orchestrator/router'

describe('parseRoute', () => {
  const agents = ['coder', 'reviewer']

  it('routes /agentName message to the correct agent', () => {
    const result = parseRoute('/coder fix the bug', agents, undefined)
    expect(isRouteError(result)).toBe(false)
    if (!isRouteError(result)) {
      expect(result.agentName).toBe('coder')
      expect(result.message).toBe('fix the bug')
    }
  })

  it('routes /agentName with multi-word message', () => {
    const result = parseRoute('/reviewer check auth.ts for issues', agents, 'coder')
    expect(isRouteError(result)).toBe(false)
    if (!isRouteError(result)) {
      expect(result.agentName).toBe('reviewer')
      expect(result.message).toBe('check auth.ts for issues')
    }
  })

  it('routes unprefixed message to default agent', () => {
    const result = parseRoute('just fix it', agents, 'coder')
    expect(isRouteError(result)).toBe(false)
    if (!isRouteError(result)) {
      expect(result.agentName).toBe('coder')
      expect(result.message).toBe('just fix it')
    }
  })

  it('returns error for unprefixed message with no default', () => {
    const result = parseRoute('just fix it', agents, undefined)
    expect(isRouteError(result)).toBe(true)
    if (isRouteError(result)) {
      expect(result.error).toContain('No default agent')
    }
  })

  it('returns error for unknown agent name', () => {
    const result = parseRoute('/unknown do stuff', agents, 'coder')
    expect(isRouteError(result)).toBe(true)
    if (isRouteError(result)) {
      expect(result.error).toContain('Unknown agent "unknown"')
      expect(result.error).toContain('coder')
      expect(result.error).toContain('reviewer')
    }
  })

  it('returns error when agent name given with no message', () => {
    const result = parseRoute('/coder', agents, undefined)
    expect(isRouteError(result)).toBe(true)
    if (isRouteError(result)) {
      expect(result.error).toContain('No message provided')
    }
  })

  it('trims whitespace from input', () => {
    const result = parseRoute('  /coder fix it  ', agents, undefined)
    expect(isRouteError(result)).toBe(false)
    if (!isRouteError(result)) {
      expect(result.agentName).toBe('coder')
      expect(result.message).toBe('fix it')
    }
  })
})

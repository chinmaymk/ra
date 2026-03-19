import { describe, it, expect } from 'bun:test'
import { truncateToolOutput } from '@chinmaymk/ra'

describe('truncateToolOutput', () => {
  it('returns content unchanged when under limit', () => {
    const content = 'short output'
    expect(truncateToolOutput(content, 1000)).toBe(content)
  })

  it('returns content unchanged when exactly at limit', () => {
    const content = 'x'.repeat(100)
    expect(truncateToolOutput(content, 100)).toBe(content)
  })

  it('truncates content exceeding limit with notice', () => {
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    expect(result).toContain('<response clipped>')
    expect(result).toContain('200')
    expect(result).toContain('100')
    // The actual content portion should be truncated to the limit
    const contentPortion = result.split('\n\n<response clipped>')[0]!
    expect(contentPortion.length).toBeLessThanOrEqual(100)
  })

  it('prefers newline boundary for truncation', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`)
    const content = lines.join('\n')
    const result = truncateToolOutput(content, 50)
    // Content before the notice should end at a newline
    const beforeNotice = result.split('\n\n<response clipped>')[0]!
    const lastChar = beforeNotice[beforeNotice.length - 1]
    // Either ends with a complete line or at the exact limit
    expect(lastChar === '\n' || lines.some(l => beforeNotice.endsWith(l))).toBe(true)
  })

  it('falls back to exact limit when no good newline boundary', () => {
    // Single long line with no newlines
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    const beforeNotice = result.split('\n\n<response clipped>')[0]!
    expect(beforeNotice.length).toBe(100)
  })

  it('includes helpful guidance in truncation notice', () => {
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    expect(result).toContain('targeted queries')
  })
})

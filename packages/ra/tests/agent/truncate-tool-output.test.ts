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

  it('truncates content exceeding limit with top and bottom portions', () => {
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    expect(result).toContain('<response clipped>')
    expect(result).toContain('200')
    expect(result).toContain('100')
    // Should contain both top and bottom content
    const parts = result.split('<response clipped>')
    expect(parts.length).toBe(2)
    // Top portion should be present before the notice
    expect(parts[0]!.trim().length).toBeGreaterThan(0)
    // Bottom portion should be present after the notice
    expect(parts[1]!.trim().length).toBeGreaterThan(0)
  })

  it('keeps top 80% and bottom 20% of the budget', () => {
    // Use lines so boundaries are clear
    const lines = Array.from({ length: 100 }, (_, i) => `line-${String(i).padStart(3, '0')}`)
    const content = lines.join('\n')
    const result = truncateToolOutput(content, 200)
    // Should start with the first line
    expect(result.startsWith('line-000')).toBe(true)
    // Should end with the last line
    expect(result.endsWith('line-099')).toBe(true)
  })

  it('prefers newline boundary for top truncation', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`)
    const content = lines.join('\n')
    const result = truncateToolOutput(content, 50)
    const beforeNotice = result.split('\n\n<response clipped>')[0]!
    const lastChar = beforeNotice[beforeNotice.length - 1]
    expect(lastChar === '\n' || lines.some(l => beforeNotice.endsWith(l))).toBe(true)
  })

  it('prefers newline boundary for bottom truncation', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`)
    const content = lines.join('\n')
    const result = truncateToolOutput(content, 50)
    // Bottom portion should start at a line boundary
    const afterNotice = result.split('to get the information you need.\n\n')[1]
    if (afterNotice) {
      const matchesLineStart = lines.some(l => afterNotice.startsWith(l))
      expect(matchesLineStart).toBe(true)
    }
  })

  it('falls back to exact positions when no good newline boundary', () => {
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    const beforeNotice = result.split('\n\n<response clipped>')[0]!
    expect(beforeNotice.length).toBe(80) // 80% of 100
    const afterNotice = result.split('to get the information you need.\n\n')[1]!
    expect(afterNotice.length).toBe(20) // 20% of 100
  })

  it('includes helpful guidance in truncation notice', () => {
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    expect(result).toContain('targeted queries')
  })

  it('reports omitted char count accurately', () => {
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    // 200 total - 80 top - 20 bottom = 100 omitted
    expect(result).toContain('100 chars omitted')
    expect(result).toContain('200 total')
  })
})

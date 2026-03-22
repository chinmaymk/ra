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

  it('truncates content exceeding limit with head+tail and omission notice', () => {
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    expect(result).toContain('chars omitted')
    // Head portion should be roughly half the budget
    const parts = result.split(/\[\.\.\..*chars omitted\.\.\.\]/)
    expect(parts).toHaveLength(2)
    // Both head and tail should have content
    expect(parts[0]!.trim().length).toBeGreaterThan(0)
    expect(parts[1]!.trim().length).toBeGreaterThan(0)
  })

  it('preserves start and end of content (head+tail)', () => {
    const head = 'HEAD_MARKER_' + 'a'.repeat(100)
    const middle = 'b'.repeat(500)
    const tail = 'c'.repeat(100) + '_TAIL_MARKER'
    const content = head + middle + tail
    const result = truncateToolOutput(content, 300)
    expect(result).toContain('HEAD_MARKER')
    expect(result).toContain('TAIL_MARKER')
    expect(result).toContain('chars omitted')
  })

  it('shows correct omitted count', () => {
    const content = 'x'.repeat(1000)
    const result = truncateToolOutput(content, 200)
    // 1000 - 200 = 800 chars omitted
    expect(result).toContain('800 chars omitted')
  })

  it('prefers newline boundary for head truncation', () => {
    // Use larger limit so newline boundary falls within the 80% window
    const lines = Array.from({ length: 40 }, (_, i) => `line-${String(i).padStart(2, '0')}`)
    const content = lines.join('\n')
    const result = truncateToolOutput(content, 200)
    // Head portion should end at a line boundary
    const headPortion = result.split(/\[\.\.\..*chars omitted\.\.\.\]/)[0]!.trimEnd()
    const headLines = headPortion.split('\n')
    const lastLine = headLines[headLines.length - 1]!
    expect(lastLine.startsWith('line-')).toBe(true)
  })

  it('prefers newline boundary for tail start', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line-${String(i).padStart(2, '0')}`)
    const content = lines.join('\n')
    const result = truncateToolOutput(content, 200)
    // Tail portion should start at a line beginning
    const tailPortion = result.split(/\[\.\.\..*chars omitted\.\.\.\]/)[1]!.trim()
    expect(tailPortion.startsWith('line-')).toBe(true)
  })

  it('falls back to exact split when no good newline boundary', () => {
    // Single long string with no newlines
    const content = 'x'.repeat(200)
    const result = truncateToolOutput(content, 100)
    const parts = result.split(/\n\n\[\.\.\..*chars omitted\.\.\.\]\n\n/)
    // Head should be roughly 50 chars, tail roughly 50 chars
    expect(parts[0]!.length).toBe(50)
    expect(parts[1]!.length).toBe(50)
  })
})

import { describe, it, expect, afterEach } from 'bun:test'
import {
  c, printHeader, printResumeHeader, startSpinner, stopSpinner,
  closeAssistantBox, printToolCall, printToolResult, printStatus,
  printCommandResponse, printError, printThinkingStart, printThinkingEnd,
  LineWrapper,
} from '../../src/interfaces/tui'

function captureStdout(fn: () => void): string {
  const chunks: string[] = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  }
  try {
    fn()
  } finally {
    process.stdout.write = origWrite
  }
  return chunks.join('')
}

describe('printHeader', () => {
  it('outputs model and session info', () => {
    const output = captureStdout(() => printHeader('claude-3', 'session-123'))
    expect(output).toContain('ra')
    expect(output).toContain('claude-3')
    expect(output).toContain('session-123')
    expect(output).toContain('/clear')
  })
})

describe('printResumeHeader', () => {
  it('outputs session id and message count', () => {
    const output = captureStdout(() => printResumeHeader('session-abc', 5))
    expect(output).toContain('session-abc')
    expect(output).toContain('5 messages')
  })
})

describe('spinner', () => {
  afterEach(() => {
    // Clean up any running spinners
    stopSpinner(true)
  })

  it('starts and stops without error', () => {
    const output = captureStdout(() => {
      startSpinner()
      stopSpinner()
    })
    // Should contain clear-line escape (no prefix on model response)
    expect(output).toContain('\x1b[K')
  })

  it('startSpinner is idempotent', () => {
    captureStdout(() => {
      startSpinner()
      startSpinner() // second call should be no-op
      stopSpinner(true)
    })
  })

  it('stopSpinner with silent clears line', () => {
    const output = captureStdout(() => {
      startSpinner()
      stopSpinner(true)
    })
    // Silent stop should contain clear-line escape
    expect(output).toContain('\x1b[K')
  })

  it('stopSpinner clears line even when no spinner running', () => {
    const output = captureStdout(() => {
      stopSpinner() // no spinner running, should still clear and add blank line
    })
    expect(output).toContain('\x1b[K')
  })
})

describe('closeAssistantBox', () => {
  it('outputs two newlines', () => {
    const output = captureStdout(() => closeAssistantBox())
    expect(output).toBe('\n\n')
  })
})

describe('printToolCall', () => {
  it('outputs tool name with diamond marker', () => {
    const output = captureStdout(() => printToolCall('read_file'))
    expect(output).toContain('◆')
    expect(output).toContain('read_file')
  })
})

describe('printToolResult', () => {
  it('outputs tool name with checkmark and timing', () => {
    const output = captureStdout(() => printToolResult('read_file', 42))
    expect(output).toContain('✔')
    expect(output).toContain('read_file')
    expect(output).toContain('42ms')
  })
})

describe('printStatus', () => {
  it('outputs dimmed status message', () => {
    const output = captureStdout(() => printStatus('Processing...'))
    expect(output).toContain('Processing...')
    expect(output).toContain(c.dim)
  })
})

describe('printCommandResponse', () => {
  it('outputs indented dimmed response', () => {
    const output = captureStdout(() => printCommandResponse('Session saved.'))
    expect(output).toContain('Session saved.')
  })
})

describe('printError', () => {
  it('outputs red error message', () => {
    const output = captureStdout(() => printError('something went wrong'))
    expect(output).toContain('Error:')
    expect(output).toContain('something went wrong')
    expect(output).toContain(c.red)
  })
})

describe('printThinkingStart', () => {
  it('outputs thinking header with dim styling', () => {
    const output = captureStdout(() => printThinkingStart())
    expect(output).toContain('thinking')
    expect(output).toContain(c.dim)
  })
})

describe('printThinkingEnd', () => {
  it('outputs thinking footer with reset', () => {
    const output = captureStdout(() => printThinkingEnd())
    expect(output).toContain(c.reset)
    expect(output).toContain('╌')
  })
})

describe('LineWrapper', () => {
  it('passes short text through unchanged', () => {
    const w = new LineWrapper('  ', 40, 2)
    expect(w.write('hello world') + w.end()).toBe('hello world')
  })

  it('wraps a long line before the overflowing word', () => {
    const w = new LineWrapper('  ', 20, 2)
    // "hello " fits (col→8), "world" (5) fits (col→13), " " ok, "overflowing" (11) would
    // put col at 13+1+11=25 > 20 so wrap before it
    const out = w.write('hello world overflowing') + w.end()
    expect(out).toBe('hello world\n  overflowing')
    expect(w.col).toBe(2 + 'overflowing'.length)
  })

  it('buffers a word split across two write() calls', () => {
    const w = new LineWrapper('  ', 20, 2)
    let out = w.write('hello wor')   // "wor" stays buffered
    out += w.write('ld end')         // "world" now complete, "end" buffered
    out += w.end()
    expect(out).toBe('hello world end')
  })

  it('wraps a cross-chunk word that overflows', () => {
    const w = new LineWrapper('  ', 15, 2)
    // col starts at 2; "hello " → col 8; then "over" is buffered
    let out = w.write('hello over')
    // "flow" completes the word "overflow" (8 chars); 8+8=16 > 15, wrap before
    out += w.write('flow next')
    out += w.end()
    expect(out).toBe('hello\n  overflow next')
  })

  it('handles explicit newlines', () => {
    const w = new LineWrapper('  ', 40, 2)
    const out = w.write('line one\nline two') + w.end()
    expect(out).toBe('line one\n  line two')
  })

  it('col reflects position after wrapping', () => {
    const w = new LineWrapper('  ', 10, 2)
    // "word1"(5) fits at col 2→7; "wrap"(4) with leading space: 7+1+4=12>10, wrap before
    w.write('word1 wrap')
    w.end()
    expect(w.col).toBe(2 + 4)  // indent(2) + "wrap"(4)
  })

  it('hard-breaks a word longer than the available width', () => {
    // width=12, indent=2 → 10 chars per line of content
    const w = new LineWrapper('  ', 12, 2)
    // "abcdefghijklmno" is 15 chars — too long for any single line (max 10)
    const out = w.write('abcdefghijklmno') + w.end()
    // First 10 chars on line 1 (col 2→12), then wrap, then 5 chars on line 2
    expect(out).toBe('abcdefghij\n  klmno')
    expect(w.col).toBe(2 + 5)
  })

  it('hard-breaks a long word after short words', () => {
    const w = new LineWrapper('  ', 15, 2)
    // "hi " at col 4; "abcdefghijklmno" (15 chars) won't fit fresh line (2+15>15)
    // hard-break: space + 10 chars fill to col 15, wrap, remaining 5 chars
    const out = w.write('hi abcdefghijklmno') + w.end()
    expect(out).toBe('hi abcdefghij\n  klmno')
  })

  it('collapses consecutive spaces to one', () => {
    const w = new LineWrapper('  ', 20, 2)
    const out = w.write('a  b') + w.end()
    // pendingSpace is a boolean so consecutive spaces collapse — fine for model output
    expect(out).toBe('a b')
  })
})

describe('tagline determinism', () => {
  it('produces same tagline for same session id', () => {
    const output1 = captureStdout(() => printHeader('m', 'same-id'))
    const output2 = captureStdout(() => printHeader('m', 'same-id'))
    expect(output1).toBe(output2)
  })

  it('can produce different taglines for different session ids', () => {
    // With enough different IDs, we should get at least one different tagline
    const outputs = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const out = captureStdout(() => printHeader('m', `session-${i}`))
      outputs.add(out)
    }
    expect(outputs.size).toBeGreaterThan(1)
  })
})

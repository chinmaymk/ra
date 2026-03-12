import { describe, it, expect, afterEach } from 'bun:test'
import {
  c, printHeader, printResumeHeader, startSpinner, stopSpinner,
  closeAssistantBox, printToolCall, printToolResult, printStatus,
  printCommandResponse, printError, printThinkingStart, printThinkingEnd,
  StreamBuffer, RESPONSE_PREFIX,
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
    const output = captureStdout(() => printToolCall('Read'))
    expect(output).toContain('◆')
    expect(output).toContain('Read')
  })
})

describe('printToolResult', () => {
  it('outputs tool name with checkmark and timing', () => {
    const output = captureStdout(() => printToolResult('Read', 42))
    expect(output).toContain('✔')
    expect(output).toContain('Read')
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

describe('StreamBuffer', () => {
  // Helper: strip ANSI codes for readable assertions
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
  const P = strip(RESPONSE_PREFIX)  // e.g. "  │ "

  it('passes short text through unchanged (no newline yet)', () => {
    const b = new StreamBuffer(40)
    // No newline → nothing output yet (buffered)
    expect(b.write('hello world')).toBe('')
    // end() flushes it
    expect(b.end()).toBe('hello world')
  })

  it('outputs a complete line when \\n arrives', () => {
    const b = new StreamBuffer(40)
    const out = b.write('hello world\n')
    // Complete line → formatted and flushed, prefix for the next line appended
    expect(strip(out)).toBe('hello world\n' + P)
  })

  it('wraps long lines at contentWidth', () => {
    const b = new StreamBuffer(10)
    // "hello world" is 11 chars — wider than contentWidth 10
    const out = b.write('hello world\n')
    const stripped = strip(out)
    // wrap-ansi should break at word boundary: "hello" and "world"
    expect(stripped).toBe('hello\n' + P + 'world\n' + P)
  })

  it('hard-breaks a word longer than contentWidth', () => {
    const b = new StreamBuffer(8)
    const out = b.write('abcdefghijkl\n')
    const stripped = strip(out)
    // 12-char word hard-broken into 8 + 4
    expect(stripped).toBe('abcdefgh\n' + P + 'ijkl\n' + P)
  })

  it('buffers across chunks and flushes at newline', () => {
    const b = new StreamBuffer(40)
    expect(b.write('hel')).toBe('')    // buffered
    expect(b.write('lo ')).toBe('')    // buffered
    expect(b.write('world')).toBe('')  // buffered
    const out = b.write('\n')
    expect(strip(out)).toBe('hello world\n' + P)
  })

  it('handles multiple lines in one chunk', () => {
    const b = new StreamBuffer(40)
    const out = b.write('line one\nline two\n')
    const stripped = strip(out)
    expect(stripped).toBe('line one\n' + P + 'line two\n' + P)
  })

  it('handles blank lines (paragraph breaks)', () => {
    const b = new StreamBuffer(40)
    const out = b.write('para one\n\npara two\n')
    const stripped = strip(out)
    expect(stripped).toBe('para one\n' + P + '\n' + P + 'para two\n' + P)
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

import { describe, it, expect, afterEach } from 'bun:test'
import {
  c, printHeader, printResumeHeader, startSpinner, stopSpinner,
  closeAssistantBox, printToolCall, printToolResult, printStatus,
  printCommandResponse, printError, printThinkingStart, printThinkingEnd,
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
    // Should contain spinner frame and chevron
    expect(output).toContain('›')
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

  it('stopSpinner outputs response prefix even when no spinner running', () => {
    const output = captureStdout(() => {
      stopSpinner() // no spinner running, should still output the response prefix
    })
    expect(output).toContain('›')
  })
})

describe('closeAssistantBox', () => {
  it('outputs a newline', () => {
    const output = captureStdout(() => closeAssistantBox())
    expect(output).toBe('\n')
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

import { describe, it, expect, afterEach } from 'bun:test'
import {
  ansi, printHeader, printResumeHeader, startSpinner, stopSpinner,
  closeAssistantBox, printToolCall, printToolResult, printStatus,
  printCommandResponse, printError, collapseThinking, createStreamState,
  handleStreamChunk, clearPendingTools, StreamBuffer, RESPONSE_PREFIX,
} from '../../src/interfaces/tui'
import { captureStdout } from '../fixtures'

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
    const output = captureStdout(() => printToolCall('Read', '{"path":"/tmp/x"}'))
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
    expect(output).toContain(ansi.dim)
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
    expect(output).toContain(ansi.red)
  })
})

describe('handleStreamChunk thinking', () => {
  it('outputs thinking header with dim styling', () => {
    const state = createStreamState()
    const output = captureStdout(() => handleStreamChunk(state, 'thinking', 'hmm'))
    expect(output).toContain('thinking')
    expect(output).toContain(ansi.dim)
    expect(state.thinkingOpened).toBe(true)
  })
})

describe('collapseThinking', () => {
  it('replaces thinking block with elapsed summary', () => {
    const state = createStreamState()
    captureStdout(() => handleStreamChunk(state, 'thinking', 'hmm'))
    const output = captureStdout(() => collapseThinking(state))
    expect(output).toContain('thinking')
    expect(output).toContain('s)')
    expect(output).toContain('╌')
    expect(state.thinkingCollapsed).toBe(true)
    expect(state.thinkingOpened).toBe(false)
  })
})

describe('handleStreamChunk text', () => {
  it('outputs each text chunk immediately to stdout', () => {
    const state = createStreamState()
    // First text chunk should open the box AND output the text
    const out1 = captureStdout(() => handleStreamChunk(state, 'text', 'Hello'))
    expect(out1).toContain('Hello')
    expect(state.boxOpened).toBe(true)

    // Subsequent chunks also appear immediately (no buffering until newline)
    const out2 = captureStdout(() => handleStreamChunk(state, 'text', ' world'))
    expect(out2).toContain(' world')

    // Newline chunk also appears immediately
    const out3 = captureStdout(() => handleStreamChunk(state, 'text', '\nline two'))
    expect(out3).toContain('\n')
    expect(out3).toContain('line two')
  })
})

describe('handleStreamChunk tool_call_start', () => {
  it('shows tool name immediately when tool_call_start arrives', () => {
    const state = createStreamState()
    const output = captureStdout(() => handleStreamChunk(state, 'tool_call_start', undefined, 'Read'))
    expect(output).toContain('◆')
    expect(output).toContain('Read')
    expect(state.pendingToolNames).toEqual(['Read'])
  })

  it('shows each tool name on its own line', () => {
    const state = createStreamState()
    const out1 = captureStdout(() => handleStreamChunk(state, 'tool_call_start', undefined, 'Read'))
    expect(out1).toContain('Read')
    expect(out1).toContain('\n')
    const out2 = captureStdout(() => handleStreamChunk(state, 'tool_call_start', undefined, 'Grep'))
    expect(out2).toContain('Grep')
    expect(out2).toContain('\n')
    expect(state.pendingToolNames).toEqual(['Read', 'Grep'])
  })

  it('closes text box before showing tool names', () => {
    const state = createStreamState()
    captureStdout(() => handleStreamChunk(state, 'text', 'some text'))
    expect(state.boxOpened).toBe(true)
    captureStdout(() => handleStreamChunk(state, 'tool_call_start', undefined, 'Read'))
    expect(state.boxOpened).toBe(false)
    expect(state.pendingToolNames).toEqual(['Read'])
  })

  it('clearPendingTools resets state', () => {
    const state = createStreamState()
    captureStdout(() => handleStreamChunk(state, 'tool_call_start', undefined, 'Read'))
    expect(state.pendingToolNames).toEqual(['Read'])
    captureStdout(() => clearPendingTools(state))
    expect(state.pendingToolNames).toEqual([])
  })
})

describe('StreamBuffer', () => {
  const P = RESPONSE_PREFIX

  it('outputs text immediately without buffering', () => {
    const b = new StreamBuffer(40)
    expect(b.write('hello world')).toBe('hello world')
    // end() is a no-op since everything was already written
    expect(b.end()).toBe('')
  })

  it('replaces newlines with newline + prefix', () => {
    const b = new StreamBuffer(40)
    const out = b.write('hello world\n')
    expect(out).toBe('hello world\n' + P)
  })

  it('streams each chunk immediately', () => {
    const b = new StreamBuffer(40)
    expect(b.write('hel')).toBe('hel')
    expect(b.write('lo ')).toBe('lo ')
    expect(b.write('world')).toBe('world')
    expect(b.write('\n')).toBe('\n' + P)
  })

  it('handles multiple lines in one chunk', () => {
    const b = new StreamBuffer(40)
    const out = b.write('line one\nline two\n')
    expect(out).toBe('line one\n' + P + 'line two\n' + P)
  })

  it('handles blank lines (paragraph breaks)', () => {
    const b = new StreamBuffer(40)
    const out = b.write('para one\n\npara two\n')
    expect(out).toBe('para one\n' + P + '\n' + P + 'para two\n' + P)
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

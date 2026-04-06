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
    // Should contain clear-line escape
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

  it('stopSpinner writes prefix even when no spinner running', () => {
    const output = captureStdout(() => {
      stopSpinner() // no spinner running, just writes response prefix
    })
    expect(output).toBe('  ')
  })

  it('shows static indicator instead of animated spinner', () => {
    const output = captureStdout(() => {
      startSpinner()
    })
    expect(output).toContain('…')
    captureStdout(() => stopSpinner(true))
  })
})

describe('closeAssistantBox', () => {
  it('outputs two newlines', () => {
    const output = captureStdout(() => closeAssistantBox())
    expect(output).toBe('\n\n')
  })
})

describe('printToolCall', () => {
  it('shows Read with path only', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Read', '{"path":"/tmp/x"}'))
    expect(output).toContain('◆')
    expect(output).toContain('Read')
    expect(output).toContain('/tmp/x')
    expect(output).toEndWith('\n')
  })

  it('shows Read with offset and limit', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Read', '{"path":"/tmp/x","offset":10,"limit":5}'))
    expect(output).toContain('/tmp/x')
    expect(output).toContain('offset=10')
    expect(output).toContain('limit=5')
  })

  it('shows Write with path', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Write', '{"path":"src/index.ts","content":"hello"}'))
    expect(output).toContain('◆ Write')
    expect(output).toContain('src/index.ts')
    expect(output).not.toContain('hello')
  })

  it('formats Edit tool as a diff with file path', () => {
    const state = createStreamState()
    const args = JSON.stringify({ path: 'src/main.ts', old_string: 'const x = 1', new_string: 'const x = 2' })
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Edit', args))
    expect(output).toContain('◆ Edit')
    expect(output).toContain('src/main.ts')
    expect(output).toContain('- const x = 1')
    expect(output).toContain('+ const x = 2')
  })

  it('truncates long Edit diffs and shows line count', () => {
    const state = createStreamState()
    const oldLines = Array.from({ length: 10 }, (_, i) => `old line ${i}`).join('\n')
    const newLines = Array.from({ length: 10 }, (_, i) => `new line ${i}`).join('\n')
    const args = JSON.stringify({ path: 'big.ts', old_string: oldLines, new_string: newLines })
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Edit', args))
    expect(output).toContain('… 6 more lines')
    expect(output).not.toContain('old line 5')
  })

  it('shows Bash with first line of command', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Bash', '{"command":"git status"}'))
    expect(output).toContain('◆ Bash')
    expect(output).toContain('git status')
  })

  it('shows Bash with only first line of multi-line command', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Bash', '{"command":"echo hello\\necho world"}'))
    expect(output).toContain('echo hello')
    expect(output).not.toContain('echo world')
  })

  it('shows Grep with pattern and path', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Grep', '{"pattern":"TODO","path":"src/","include":"*.ts"}'))
    expect(output).toContain('◆ Grep')
    expect(output).toContain('"TODO"')
    expect(output).toContain('src/')
    expect(output).toContain('*.ts')
  })

  it('shows Glob with pattern', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'Glob', '{"pattern":"**/*.ts","path":"src/"}'))
    expect(output).toContain('◆ Glob')
    expect(output).toContain('**/*.ts')
    expect(output).toContain('src/')
  })

  it('shows MoveFile with arrow', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'MoveFile', '{"source":"a.ts","destination":"b.ts"}'))
    expect(output).toContain('a.ts → b.ts')
  })

  it('shows WebFetch with method and url', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'WebFetch', '{"url":"https://example.com","method":"POST"}'))
    expect(output).toContain('POST')
    expect(output).toContain('https://example.com')
  })

  it('falls back to flat JSON for unknown tools', () => {
    const state = createStreamState()
    const output = captureStdout(() => printToolCall(state, 'tc-1', 'CustomTool', '{"key":"value"}'))
    expect(output).toContain('◆ CustomTool')
    expect(output).toContain('value')
  })

  it('tracks active tools in state', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Read', '{"path":"/tmp/x"}'))
    expect(state.activeTools).toHaveLength(1)
    expect(state.activeTools[0]!.id).toBe('tc-1')
    expect(state.activeTools[0]!.name).toBe('Read')
    expect(state.activeTools[0]!.detail).toContain('/tmp/x')
  })
})

describe('printToolResult', () => {
  it('outputs tool name with checkmark and timing', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Read', '{"path":"/tmp/x"}'))
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'Read', 42))
    expect(output).toContain('✔')
    expect(output).toContain('Read')
    expect(output).toContain('42ms')
  })

  it('includes original detail and result summary in merged line', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Read', '{"path":"/tmp/x"}'))
    const content = '1: foo\n2: bar\n3: baz\n'
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'Read', 5, content))
    expect(output).toContain('/tmp/x')
    expect(output).toContain('3 lines')
    expect(output).toContain('5ms')
  })

  it('shows match count for Grep results', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Grep', '{"pattern":"TODO","path":"src/"}'))
    const content = 'src/a.ts:10:match1\nsrc/b.ts:20:match2\n'
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'Grep', 12, content))
    expect(output).toContain('2 matches')
  })

  it('shows no matches for empty Grep', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Grep', '{"pattern":"foo"}'))
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'Grep', 3, 'No matches found for "foo"'))
    expect(output).toContain('no matches')
  })

  it('shows file count for Glob results', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Glob', '{"pattern":"**/*.ts"}'))
    const content = 'src/a.ts\nsrc/b.ts\n'
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'Glob', 8, content))
    expect(output).toContain('2 files')
  })

  it('shows entry count for LS results', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'LS', '{"path":"."}'))
    const content = 'src/\npackage.json\ntsconfig.json\n'
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'LS', 2, content))
    expect(output).toContain('3 entries')
  })

  it('shows exit code and line count for Bash results', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Bash', '{"command":"ls"}'))
    const content = '<stdout>line 1\nline 2\n</stdout>\n<exit_code>0</exit_code>'
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'Bash', 100, content))
    expect(output).toContain('exit 0')
    expect(output).toContain('2 lines')
  })

  it('shows non-zero exit code for Bash', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Bash', '{"command":"false"}'))
    const content = '<stderr>err\n</stderr>\n<exit_code>1</exit_code>'
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'Bash', 50, content))
    expect(output).toContain('exit 1')
  })

  it('shows status for WebFetch results', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'WebFetch', '{"url":"https://example.com"}'))
    const content = JSON.stringify({ status: 200, headers: {}, body: 'ok' })
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'WebFetch', 200, content))
    expect(output).toContain('200')
  })

  it('shows only timing when no content provided', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Edit', '{"path":"x.ts","old_string":"a","new_string":"b"}'))
    const output = captureStdout(() => printToolResult(state, 'tc-1', 'Edit', 10))
    expect(output).toContain('10ms')
    expect(output).toContain('✔')
  })

  it('removes completed tool from activeTools', () => {
    const state = createStreamState()
    captureStdout(() => printToolCall(state, 'tc-1', 'Read', '{"path":"/tmp/x"}'))
    expect(state.activeTools).toHaveLength(1)
    captureStdout(() => printToolResult(state, 'tc-1', 'Read', 5))
    // Non-TTY falls through, but tool should still be trackable
    expect(state.activeTools).toHaveLength(0)
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

  it('adds spacing after tools section when text starts', () => {
    const state = createStreamState()
    // Simulate a completed tool
    state.activeTools.push({ id: 'tc-1', name: 'Read', detail: '/tmp/x', lineCount: 1 })
    const output = captureStdout(() => handleStreamChunk(state, 'text', 'Hello'))
    // Should contain an extra newline for spacing
    expect(output).toContain('\n')
    expect(output).toContain('Hello')
    expect(state.activeTools).toHaveLength(0)
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

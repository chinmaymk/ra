import { describe, it, expect } from 'bun:test'
import {
  clearOldToolResults,
  clearOldThinking,
  createContextClearingMiddleware,
  type ToolResultClearingConfig,
  type ThinkingClearingConfig,
} from '@chinmaymk/ra'
import type { IMessage } from '@chinmaymk/ra'
import { makeModelCallCtx } from './test-utils'

function toolResultMsg(toolCallId: string, content: string): IMessage {
  return { role: 'tool', content, toolCallId }
}

function assistantWithToolCalls(toolCalls: { id: string; name: string }[]): IMessage {
  return {
    role: 'assistant',
    content: '',
    toolCalls: toolCalls.map(tc => ({ ...tc, arguments: '{}' })),
  }
}

describe('clearOldToolResults', () => {
  it('clears old tool results beyond keep threshold', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', 'x'.repeat(5000)),
      assistantWithToolCalls([{ id: 'tc2', name: 'Read' }]),
      toolResultMsg('tc2', 'y'.repeat(5000)),
      assistantWithToolCalls([{ id: 'tc3', name: 'Read' }]),
      toolResultMsg('tc3', 'z'.repeat(5000)),
    ]

    const config: ToolResultClearingConfig = { enabled: true, keep: 2, clearAtLeast: 100 }
    const freed = clearOldToolResults(messages, config)

    expect(freed).toBeGreaterThan(0)
    expect(messages[2]!.content).toBe('[tool result cleared]')
    // Last 2 tool results preserved
    expect(messages[4]!.content).toBe('y'.repeat(5000))
    expect(messages[6]!.content).toBe('z'.repeat(5000))
  })

  it('skips clearing when too few tokens would be freed', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', 'short'),
    ]

    const config: ToolResultClearingConfig = { enabled: true, keep: 0, clearAtLeast: 10000 }
    const freed = clearOldToolResults(messages, config)

    expect(freed).toBe(0)
    expect(messages[2]!.content).toBe('short')
  })

  it('respects excludeTools', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', 'x'.repeat(5000)),
      assistantWithToolCalls([{ id: 'tc2', name: 'Write' }]),
      toolResultMsg('tc2', 'y'.repeat(5000)),
    ]

    const config: ToolResultClearingConfig = {
      enabled: true, keep: 0, clearAtLeast: 100, excludeTools: ['Read'],
    }
    const freed = clearOldToolResults(messages, config)

    // Read was excluded, only Write got cleared
    expect(messages[2]!.content).toBe('x'.repeat(5000))
    expect(messages[4]!.content).toBe('[tool result cleared]')
    expect(freed).toBeGreaterThan(0)
  })

  it('uses custom placeholder', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', 'x'.repeat(5000)),
    ]

    const config: ToolResultClearingConfig = {
      enabled: true, keep: 0, clearAtLeast: 100, placeholder: '[redacted]',
    }
    clearOldToolResults(messages, config)

    expect(messages[2]!.content).toBe('[redacted]')
  })

  it('does not clear already-cleared messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', '[tool result cleared]'),
      assistantWithToolCalls([{ id: 'tc2', name: 'Read' }]),
      toolResultMsg('tc2', 'y'.repeat(5000)),
    ]

    const config: ToolResultClearingConfig = { enabled: true, keep: 0, clearAtLeast: 100 }
    const freed = clearOldToolResults(messages, config)

    // Only tc2 got cleared (tc1 was already cleared)
    expect(freed).toBeGreaterThan(0)
    expect(messages[4]!.content).toBe('[tool result cleared]')
  })

  it('returns 0 when all results are within keep window', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', 'x'.repeat(5000)),
    ]

    const config: ToolResultClearingConfig = { enabled: true, keep: 5, clearAtLeast: 100 }
    const freed = clearOldToolResults(messages, config)

    expect(freed).toBe(0)
  })
})

describe('clearOldThinking', () => {
  it('clears thinking parts from older assistant messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking' as 'text', text: 'x'.repeat(5000) },
          { type: 'text', text: 'response 1' },
        ],
      },
      { role: 'user', content: 'next' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking' as 'text', text: 'y'.repeat(5000) },
          { type: 'text', text: 'response 2' },
        ],
      },
      { role: 'user', content: 'last' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking' as 'text', text: 'z'.repeat(5000) },
          { type: 'text', text: 'response 3' },
        ],
      },
    ]

    const config: ThinkingClearingConfig = { enabled: true, keepRecent: 1 }
    const freed = clearOldThinking(messages, config)

    expect(freed).toBeGreaterThan(0)
    // First two assistant messages should have thinking removed
    const first = messages[1]!.content as { type: string; text: string }[]
    expect(first).toHaveLength(1)
    expect(first[0]!.type).toBe('text')

    const second = messages[3]!.content as { type: string; text: string }[]
    expect(second).toHaveLength(1)
    expect(second[0]!.type).toBe('text')

    // Last assistant message preserved
    const last = messages[5]!.content as { type: string; text: string }[]
    expect(last).toHaveLength(2)
  })

  it('skips string content messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'text response' },
      { role: 'user', content: 'next' },
      { role: 'assistant', content: 'another text' },
    ]

    const config: ThinkingClearingConfig = { enabled: true, keepRecent: 1 }
    const freed = clearOldThinking(messages, config)

    expect(freed).toBe(0)
    expect(messages[1]!.content).toBe('text response')
  })

  it('returns 0 when no thinking parts exist', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
    ]

    const config: ThinkingClearingConfig = { enabled: true, keepRecent: 0 }
    const freed = clearOldThinking(messages, config)

    expect(freed).toBe(0)
  })
})

describe('createContextClearingMiddleware', () => {
  it('skips clearing when context usage is below threshold', async () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', 'x'.repeat(5000)),
    ]

    const middleware = createContextClearingMiddleware({
      toolResults: { enabled: true, keep: 0, clearAtLeast: 100 },
      triggerThreshold: 0.60,
    })

    const ctx = makeModelCallCtx(messages)
    // Low usage — should not trigger
    ctx.loop.lastUsage = { inputTokens: 1000, outputTokens: 0 }
    await middleware(ctx)

    // Content unchanged since usage ratio is well below threshold
    expect(ctx.request.messages[2]!.content).toBe('x'.repeat(5000))
  })

  it('clears tool results when context usage exceeds threshold', async () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', 'x'.repeat(5000)),
      assistantWithToolCalls([{ id: 'tc2', name: 'Read' }]),
      toolResultMsg('tc2', 'y'.repeat(5000)),
    ]

    const middleware = createContextClearingMiddleware({
      toolResults: { enabled: true, keep: 1, clearAtLeast: 100 },
      triggerThreshold: 0.10,
    })

    const ctx = makeModelCallCtx(messages)
    // High usage — should trigger
    ctx.loop.lastUsage = { inputTokens: 150000, outputTokens: 0 }
    await middleware(ctx)

    expect(ctx.request.messages[2]!.content).toBe('[tool result cleared]')
    expect(ctx.request.messages[4]!.content).toBe('y'.repeat(5000))
  })

  it('does nothing when both features are disabled', async () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'hi' },
      assistantWithToolCalls([{ id: 'tc1', name: 'Read' }]),
      toolResultMsg('tc1', 'x'.repeat(5000)),
    ]

    const middleware = createContextClearingMiddleware({
      toolResults: { enabled: false },
      thinking: { enabled: false },
      triggerThreshold: 0.01,
    })

    const ctx = makeModelCallCtx(messages)
    ctx.loop.lastUsage = { inputTokens: 150000, outputTokens: 0 }
    await middleware(ctx)

    expect(ctx.request.messages[2]!.content).toBe('x'.repeat(5000))
  })
})

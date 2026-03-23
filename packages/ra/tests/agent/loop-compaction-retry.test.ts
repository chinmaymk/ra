import { describe, it, expect } from 'bun:test'
import { forceCompact, isContextLengthError } from '@chinmaymk/ra'
import type { IProvider, ChatResponse } from '@chinmaymk/ra'
import { makeModelCallCtx } from './test-utils'

function summaryProvider(): IProvider {
  return {
    name: 'mock',
    chat: async (): Promise<ChatResponse> => ({
      message: { role: 'assistant', content: 'Summary.' },
    }),
    async *stream() { yield { type: 'done' as const } },
  }
}

describe('forceCompact', () => {
  it('compacts regardless of threshold', async () => {
    const longText = 'word '.repeat(200)
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: longText },
      { role: 'user' as const, content: longText },
      { role: 'assistant' as const, content: longText },
      { role: 'user' as const, content: 'latest' },
    ]
    const ctx = makeModelCallCtx(messages)
    const result = await forceCompact(summaryProvider(), { enabled: true, threshold: 0.99, strategy: 'summarize', contextWindow: 100 }, ctx)
    expect(result).toBe(true)
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(hasSummary).toBe(true)
  })
})

describe('AgentLoop context-length error recovery', () => {
  it('error recovery path works via direct forceCompact call', async () => {
    const longContent = 'word '.repeat(200)
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: longContent },
      { role: 'user' as const, content: longContent },
      { role: 'assistant' as const, content: longContent },
      { role: 'user' as const, content: 'latest' },
    ]
    const config = { enabled: true, threshold: 0.8, strategy: 'summarize' as const, maxTokens: 99999, contextWindow: 100 }

    expect(isContextLengthError(new Error('This request has too many tokens'))).toBe(true)

    const ctx = makeModelCallCtx(messages)
    const compacted = await forceCompact(summaryProvider(), config, ctx)
    expect(compacted).toBe(true)
    expect(ctx.request.messages.length).toBeLessThan(messages.length)
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(hasSummary).toBe(true)
  })

  it('forceCompact returns false when nothing to compact', async () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'hello' },
    ]
    const config = { enabled: true, threshold: 0.8, maxTokens: 99999, contextWindow: 100 }
    const ctx = makeModelCallCtx(messages)
    const compacted = await forceCompact(summaryProvider(), config, ctx)
    expect(compacted).toBe(false)
  })
})

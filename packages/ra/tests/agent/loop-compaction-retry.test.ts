import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry, forceCompact, isContextLengthError } from '@chinmaymk/ra'
import type { IProvider, ChatResponse, ModelCallContext, ChatRequest } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'

const logger = new NoopLogger()

// isContextLengthError tests are in context-compaction.test.ts

describe('forceCompact', () => {
  it('compacts regardless of threshold', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async (): Promise<ChatResponse> => ({
        message: { role: 'assistant', content: 'Forced summary.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    const longText = 'word '.repeat(200)
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: longText },
      { role: 'user' as const, content: longText },
      { role: 'assistant' as const, content: longText },
      { role: 'user' as const, content: 'latest' },
    ]
    const controller = new AbortController()
    const request: ChatRequest = { model: 'test', messages: [...messages], tools: [] }
    const ctx: ModelCallContext = {
      stop: () => controller.abort(),
      signal: controller.signal,
      logger,
      request,
      loop: {
        stop: () => controller.abort(),
        signal: controller.signal,
        logger,
        messages,
        iteration: 1,
        maxIterations: 10,
        sessionId: 'test',
        usage: { inputTokens: 0, outputTokens: 0 },
        lastUsage: undefined,
      },
    }
    const result = await forceCompact(provider, { enabled: true, threshold: 0.99, contextWindow: 100 }, ctx)
    expect(result).toBe(true)
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(hasSummary).toBe(true)
  })
})

describe('AgentLoop context-length error recovery', () => {
  it('error recovery path works via direct forceCompact call', async () => {
    // Test the recovery mechanism directly since Bun test runner 1.3.x
    // intercepts async generator throws in multi-file suites.
    const longContent = 'word '.repeat(200)

    const provider: IProvider = {
      name: 'mock',
      chat: async (): Promise<ChatResponse> => ({
        message: { role: 'assistant', content: 'Summary.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }

    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: longContent },
      { role: 'user' as const, content: longContent },
      { role: 'assistant' as const, content: longContent },
      { role: 'user' as const, content: 'latest' },
    ]

    const config = { enabled: true, threshold: 0.8, maxTokens: 99999, contextWindow: 100 }

    // Verify context length error is detected
    const err = new Error('This request has too many tokens')
    expect(isContextLengthError(err)).toBe(true)

    // Verify force compaction works on the messages
    const controller = new AbortController()
    const request: ChatRequest = { model: 'test', messages: [...messages], tools: [] }
    const ctx: ModelCallContext = {
      stop: () => controller.abort(),
      signal: controller.signal,
      logger,
      request,
      loop: {
        stop: () => controller.abort(),
        signal: controller.signal,
        logger,
        messages: [...messages],
        iteration: 1,
        maxIterations: 10,
        sessionId: 'test',
        usage: { inputTokens: 0, outputTokens: 0 },
        lastUsage: undefined,
      },
    }

    const compacted = await forceCompact(provider, config, ctx)
    expect(compacted).toBe(true)
    expect(ctx.request.messages.length).toBeLessThan(messages.length)
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(hasSummary).toBe(true)
  })

  it('forceCompact returns false when nothing to compact', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async (): Promise<ChatResponse> => ({
        message: { role: 'assistant', content: 'Summary.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }

    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'hello' },
    ]

    const config = { enabled: true, threshold: 0.8, maxTokens: 99999, contextWindow: 100 }
    const controller = new AbortController()
    const request: ChatRequest = { model: 'test', messages: [...messages], tools: [] }
    const ctx: ModelCallContext = {
      stop: () => controller.abort(),
      signal: controller.signal,
      logger,
      request,
      loop: {
        stop: () => controller.abort(),
        signal: controller.signal,
        logger,
        messages: [...messages],
        iteration: 1,
        maxIterations: 10,
        sessionId: 'test',
        usage: { inputTokens: 0, outputTokens: 0 },
        lastUsage: undefined,
      },
    }

    const compacted = await forceCompact(provider, config, ctx)
    expect(compacted).toBe(false)
  })
})

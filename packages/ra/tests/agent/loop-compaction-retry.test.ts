import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry, isContextLengthError, forceCompact } from '@chinmaymk/ra'
import type { IProvider, ChatResponse, ModelCallContext, ChatRequest } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'

const logger = new NoopLogger()

describe('isContextLengthError', () => {
  it('matches Anthropic SDK errors', () => {
    expect(isContextLengthError(new Error('400 request too large'))).toBe(true)
    expect(isContextLengthError(new Error('400 prompt is too long: 250000 tokens > 200000 maximum'))).toBe(true)
    expect(isContextLengthError(new Error('400 input length and max_tokens exceed context limit: 188240 + 21333 > 200000, decrease input length or max_tokens and try again'))).toBe(true)
    expect(isContextLengthError(new Error('413 Request too large'))).toBe(true)
    expect(isContextLengthError(new Error('413 Request size exceeds model context window'))).toBe(true)
  })

  it('matches OpenAI / Azure SDK errors', () => {
    expect(isContextLengthError(new Error("400 This model's maximum context length is 128000 tokens. However, you requested 150000 tokens (149000 in the messages, 1000 in the completion)."))).toBe(true)
    // Responses API variant
    expect(isContextLengthError(new Error('400 Your input exceeds the context window of this model.'))).toBe(true)
  })

  it('matches OpenAI error.code property', () => {
    const err = Object.assign(new Error('some message'), { code: 'context_length_exceeded' })
    expect(isContextLengthError(err)).toBe(true)
  })

  it('matches Ollama errors', () => {
    expect(isContextLengthError(new Error('prompt too long; exceeded max context length by 4 tokens'))).toBe(true)
  })

  it('matches Google Gemini errors', () => {
    expect(isContextLengthError(new Error('[400 Bad Request] Request exceeds the maximum number of tokens'))).toBe(true)
  })

  it('matches Bedrock errors', () => {
    expect(isContextLengthError(new Error('ValidationException: Too many tokens, please reduce your prompt'))).toBe(true)
    expect(isContextLengthError(new Error('ValidationException: prompt is too long'))).toBe(true)
  })

  it('matches generic context length patterns', () => {
    expect(isContextLengthError(new Error('context length exceeded'))).toBe(true)
    expect(isContextLengthError(new Error('token limit exceeded'))).toBe(true)
    expect(isContextLengthError(new Error('input too long'))).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isContextLengthError(new Error('API rate limit'))).toBe(false)
    expect(isContextLengthError(new Error('network timeout'))).toBe(false)
    expect(isContextLengthError(new Error('authentication failed'))).toBe(false)
    expect(isContextLengthError(new Error('internal server error'))).toBe(false)
  })
})

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

import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry, ProviderError, withRetry } from '@chinmaymk/ra'
import type { IProvider, StreamChunk, ChatRequest } from '@chinmaymk/ra'

function mockProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text', delta: 'done' }, { type: 'done' }]
      for (const chunk of chunks) yield chunk
    },
  }
}

describe('ProviderError', () => {
  it('classifies 429 as rate_limit', () => {
    const err = ProviderError.from({ status: 429, message: 'Too many requests' })
    expect(err.category).toBe('rate_limit')
    expect(err.retryable).toBe(true)
  })

  it('classifies 401 as auth', () => {
    const err = ProviderError.from({ status: 401, message: 'Unauthorized' })
    expect(err.category).toBe('auth')
    expect(err.retryable).toBe(false)
  })

  it('classifies 403 as auth', () => {
    const err = ProviderError.from({ status: 403, message: 'Forbidden' })
    expect(err.category).toBe('auth')
    expect(err.retryable).toBe(false)
  })

  it('classifies 500 as server', () => {
    const err = ProviderError.from({ status: 500, message: 'Internal server error' })
    expect(err.category).toBe('server')
    expect(err.retryable).toBe(true)
  })

  it('classifies 529 as overloaded', () => {
    const err = ProviderError.from({ status: 529, message: 'Overloaded' })
    expect(err.category).toBe('overloaded')
    expect(err.retryable).toBe(true)
  })

  it('classifies network errors', () => {
    const err = ProviderError.from(new Error('fetch failed'))
    expect(err.category).toBe('network')
    expect(err.retryable).toBe(true)
  })

  it('classifies ECONNREFUSED as network', () => {
    const err = ProviderError.from(new Error('connect ECONNREFUSED 127.0.0.1:443'))
    expect(err.category).toBe('network')
    expect(err.retryable).toBe(true)
  })

  it('classifies unknown errors', () => {
    const err = ProviderError.from(new Error('something unexpected'))
    expect(err.category).toBe('unknown')
    expect(err.retryable).toBe(false)
  })

  it('passes through existing ProviderError', () => {
    const original = new ProviderError('rate limited', { category: 'rate_limit', statusCode: 429 })
    const result = ProviderError.from(original)
    expect(result).toBe(original)
  })

  it('extracts retry-after header', () => {
    const err = ProviderError.from({
      status: 429,
      message: 'rate limited',
      headers: { get: (name: string) => name === 'retry-after' ? '5' : null },
    })
    expect(err.retryAfterMs).toBe(5000)
  })
})

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    let calls = 0
    const result = await withRetry(async () => { calls++; return 'ok' }, { maxRetries: 3, delays: [10] })
    expect(result).toBe('ok')
    expect(calls).toBe(1)
  })

  it('retries on retryable errors', async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('rate limited'), { status: 429 })
      return 'ok'
    }, { maxRetries: 3, delays: [10, 10, 10] })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('throws immediately on non-retryable errors', async () => {
    let calls = 0
    try {
      await withRetry(async () => {
        calls++
        throw Object.assign(new Error('unauthorized'), { status: 401 })
      }, { maxRetries: 3, delays: [10] })
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).category).toBe('auth')
    }
    expect(calls).toBe(1)
  })

  it('gives up after maxRetries', async () => {
    let calls = 0
    try {
      await withRetry(async () => {
        calls++
        throw Object.assign(new Error('server error'), { status: 500 })
      }, { maxRetries: 2, delays: [10, 10] })
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).category).toBe('server')
    }
    expect(calls).toBe(3) // initial + 2 retries
  })

  it('calls onRetry callback', async () => {
    const retries: number[] = []
    let calls = 0
    await withRetry(async () => {
      calls++
      if (calls < 2) throw Object.assign(new Error('rate limited'), { status: 429 })
      return 'ok'
    }, { maxRetries: 3, delays: [10], onRetry: (_err, attempt) => retries.push(attempt) })
    expect(retries).toEqual([1])
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    try {
      await withRetry(async () => {
        calls++
        throw Object.assign(new Error('rate limited'), { status: 429 })
      }, { maxRetries: 3, delays: [10], signal: controller.signal })
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
    }
    expect(calls).toBe(1)
  })
})

describe('AgentLoop provider error handling', () => {
  it('retries on transient provider errors during stream', async () => {
    let streamCalls = 0
    const provider: IProvider = {
      name: 'flaky',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        streamCalls++
        if (streamCalls === 1) throw Object.assign(new Error('rate limited'), { status: 429 })
        yield { type: 'text', delta: 'hello' }
        yield { type: 'done' }
      },
    }
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, maxRetries: 3 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.messages.at(-1)?.content).toBe('hello')
    expect(streamCalls).toBe(2)
  })

  it('throws ProviderError on non-retryable errors', async () => {
    const provider: IProvider = {
      name: 'auth-fail',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        throw Object.assign(new Error('Invalid API key'), { status: 401 })
      },
    }
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, maxRetries: 3 })
    try {
      await loop.run([{ role: 'user', content: 'hi' }])
      expect(true).toBe(false) // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).category).toBe('auth')
    }
  })

  it('fires onError middleware with ProviderError', async () => {
    const errors: Error[] = []
    const provider: IProvider = {
      name: 'fail',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        throw Object.assign(new Error('Forbidden'), { status: 403 })
      },
    }
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      maxIterations: 10,
      maxRetries: 0,
      middleware: { onError: [async (ctx) => { errors.push(ctx.error) }] },
    })
    try { await loop.run([{ role: 'user', content: 'hi' }]) } catch {}
    expect(errors.length).toBe(1)
    expect(errors[0]).toBeInstanceOf(ProviderError)
  })

  it('resets accumulators on retry so partial stream data is discarded', async () => {
    let streamCalls = 0
    const provider: IProvider = {
      name: 'partial-fail',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        streamCalls++
        if (streamCalls === 1) {
          yield { type: 'text', delta: 'partial' }
          throw Object.assign(new Error('connection reset'), { status: 500 })
        }
        yield { type: 'text', delta: 'complete' }
        yield { type: 'done' }
      },
    }
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, maxRetries: 3 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    // Should only have "complete", not "partialcomplete"
    expect(result.messages.at(-1)?.content).toBe('complete')
  })
})

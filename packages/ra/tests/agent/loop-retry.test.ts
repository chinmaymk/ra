import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry, ProviderError } from '@chinmaymk/ra'
import type { IProvider } from '@chinmaymk/ra'

describe('AgentLoop stream retry', () => {
  it('retries transient errors and succeeds', async () => {
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

  it('throws non-retryable errors through to caller', async () => {
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
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).category).toBe('auth')
    }
  })

  it('surfaces errors to onError middleware', async () => {
    const errors: Error[] = []
    const provider: IProvider = {
      name: 'fail',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        throw Object.assign(new Error('Forbidden'), { status: 403 })
      },
    }
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(), maxIterations: 10, maxRetries: 0,
      middleware: { onError: [async (ctx) => { errors.push(ctx.error) }] },
    })
    try { await loop.run([{ role: 'user', content: 'hi' }]) } catch {}
    expect(errors.length).toBe(1)
    expect(errors[0]).toBeInstanceOf(ProviderError)
  })

  it('discards partial stream data on retry', async () => {
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
    expect(result.messages.at(-1)?.content).toBe('complete')
  })
})

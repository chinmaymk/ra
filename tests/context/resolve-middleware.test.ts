import { describe, it, expect } from 'bun:test'
import { createResolverMiddleware } from '../../src/context/resolve-middleware'
import type { ModelCallContext } from '../../src/agent/types'
import type { PatternResolver } from '../../src/context/resolvers'
import { NoopLogger } from '../../src/observability/logger'

const logger = new NoopLogger()

const echoResolver: PatternResolver = {
  name: 'echo',
  pattern: /@(\w+)/g,
  async resolve(ref: string) {
    return `content of ${ref}`
  },
}

function makeCtx(messages: { role: string; content: string }[]): ModelCallContext {
  const controller = new AbortController()
  return {
    stop: () => controller.abort(),
    signal: controller.signal,
    logger,
    request: {
      model: 'test',
      messages: messages as any,
    },
    loop: {
      stop: () => controller.abort(),
      signal: controller.signal,
      logger,
      messages: messages as any,
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
    },
  }
}

describe('createResolverMiddleware', () => {
  it('resolves references in last user message', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      { role: 'user', content: 'look at @readme' },
    ])
    await mw(ctx)
    const content = ctx.request.messages[0]!.content as string
    expect(content).toContain('look at @readme')
    expect(content).toContain('<resolved-context ref="@readme">')
    expect(content).toContain('content of readme')
  })

  it('only processes the last user message', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      { role: 'user', content: 'check @old' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'now @new' },
    ])
    await mw(ctx)
    // First user message should be unchanged
    expect(ctx.request.messages[0]!.content).toBe('check @old')
    // Last user message should have resolved content
    const last = ctx.request.messages[2]!.content as string
    expect(last).toContain('content of new')
  })

  it('does nothing when no resolvers are provided', async () => {
    const mw = createResolverMiddleware([], '/tmp')
    const ctx = makeCtx([{ role: 'user', content: '@foo' }])
    await mw(ctx)
    expect(ctx.request.messages[0]!.content).toBe('@foo')
  })

  it('does nothing when no patterns match', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([{ role: 'user', content: 'plain text' }])
    await mw(ctx)
    expect(ctx.request.messages[0]!.content).toBe('plain text')
  })

  it('does nothing when there are no user messages', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([{ role: 'assistant', content: '@foo' }])
    await mw(ctx)
    expect(ctx.request.messages[0]!.content).toBe('@foo')
  })

  it('skips already-resolved messages on subsequent loop iterations', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      { role: 'user', content: 'look at @readme' },
    ])
    // First call — resolves
    await mw(ctx)
    const afterFirst = ctx.request.messages[0]!.content as string
    expect(afterFirst).toContain('content of readme')

    // Second call — should skip (marker present)
    await mw(ctx)
    const afterSecond = ctx.request.messages[0]!.content as string
    expect(afterSecond).toBe(afterFirst) // unchanged
  })
})

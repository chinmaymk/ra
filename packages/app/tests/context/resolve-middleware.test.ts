import { describe, it, expect } from 'bun:test'
import { createResolverMiddleware } from '../../src/context/resolve-middleware'
import { NoopLogger } from '@chinmaymk/ra'
import type { ModelCallContext, ContentPart } from '@chinmaymk/ra'
import type { PatternResolver } from '../../src/context/resolvers'

const logger = new NoopLogger()

const echoResolver: PatternResolver = {
  name: 'echo',
  pattern: /@(\w+)/g,
  async resolve(ref: string) {
    return `content of ${ref}`
  },
}

function makeCtx(messages: { role: string; content: string | ContentPart[] }[]): ModelCallContext {
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

  it('resolves references in system prompt messages', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      { role: 'system', content: 'You are helpful. See @config' },
      { role: 'user', content: 'hello' },
    ])
    await mw(ctx)
    const systemContent = ctx.request.messages[0]!.content as string
    expect(systemContent).toContain('You are helpful. See @config')
    expect(systemContent).toContain('<resolved-context ref="@config">')
    expect(systemContent).toContain('content of config')
    // User message should be unchanged (no patterns)
    expect(ctx.request.messages[1]!.content).toBe('hello')
  })

  it('resolves references in both system prompt and user message', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      { role: 'system', content: 'Use @rules' },
      { role: 'user', content: 'check @readme' },
    ])
    await mw(ctx)
    const systemContent = ctx.request.messages[0]!.content as string
    expect(systemContent).toContain('content of rules')
    const userContent = ctx.request.messages[1]!.content as string
    expect(userContent).toContain('content of readme')
  })

  it('skips already-resolved system prompt on subsequent iterations', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      { role: 'system', content: 'See @config' },
      { role: 'user', content: 'look at @readme' },
    ])
    await mw(ctx)
    const systemAfterFirst = ctx.request.messages[0]!.content as string
    const userAfterFirst = ctx.request.messages[1]!.content as string

    // Second call — both should be unchanged (markers present)
    await mw(ctx)
    expect(ctx.request.messages[0]!.content).toBe(systemAfterFirst)
    expect(ctx.request.messages[1]!.content).toBe(userAfterFirst)
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

  it('preserves _messageId across resolution (spread copies the ID)', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const messages = [
      { role: 'system', content: 'See @config', _messageId: 'sys-1' },
      { role: 'user', content: 'look at @readme', _messageId: 'usr-1' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)

    // _messageId must survive even if the resolver creates a new object
    // (via spread). The history middleware tracks by ID, not object identity.
    expect(ctx.request.messages[0]!._messageId).toBe('sys-1')
    expect(ctx.request.messages[1]!._messageId).toBe('usr-1')
    // Content should still be resolved
    expect((ctx.request.messages[0]!.content as string)).toContain('content of config')
    expect((ctx.request.messages[1]!.content as string)).toContain('content of readme')
  })

  it('resolves references in system message with ContentPart[] content', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'You are helpful. See @config' },
        ] as ContentPart[],
      },
      { role: 'user', content: 'hello' },
    ])
    await mw(ctx)
    const parts = ctx.request.messages[0]!.content as ContentPart[]
    expect(Array.isArray(parts)).toBe(true)
    // Original text part preserved
    expect(parts[0]).toEqual({ type: 'text', text: 'You are helpful. See @config' })
    // Resolved content appended as new text part
    const resolvedPart = parts[1] as { type: 'text'; text: string }
    expect(resolvedPart.type).toBe('text')
    expect(resolvedPart.text).toContain('<resolved-context ref="@config">')
    expect(resolvedPart.text).toContain('content of config')
  })

  it('resolves references across multiple text parts in ContentPart[]', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'First part with @rules' },
          { type: 'text', text: 'Second part with @config' },
        ] as ContentPart[],
      },
      { role: 'user', content: 'hello' },
    ])
    await mw(ctx)
    const parts = ctx.request.messages[0]!.content as ContentPart[]
    // Original parts + one appended resolved part
    expect(parts).toHaveLength(3)
    const resolvedPart = parts[2] as { type: 'text'; text: string }
    expect(resolvedPart.text).toContain('content of rules')
    expect(resolvedPart.text).toContain('content of config')
  })

  it('skips already-resolved ContentPart[] system message on subsequent iterations', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'See @config' },
        ] as ContentPart[],
      },
      { role: 'user', content: 'hello' },
    ])
    await mw(ctx)
    const afterFirst = ctx.request.messages[0]!.content as ContentPart[]
    expect(afterFirst).toHaveLength(2) // original + resolved

    // Second call — should skip (marker present in appended part)
    await mw(ctx)
    const afterSecond = ctx.request.messages[0]!.content as ContentPart[]
    expect(afterSecond).toEqual(afterFirst)
  })

  it('skips ContentPart[] with non-text parts (no text to resolve)', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      {
        role: 'system',
        content: [
          { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
        ] as ContentPart[],
      },
      { role: 'user', content: 'hello' },
    ])
    await mw(ctx)
    const parts = ctx.request.messages[0]!.content as ContentPart[]
    // Should remain unchanged — no text parts to resolve
    expect(parts).toHaveLength(1)
    expect(parts[0]!.type).toBe('image')
  })

  it('preserves _messageId for ContentPart[] system messages', async () => {
    const mw = createResolverMiddleware([echoResolver], '/tmp')
    const ctx = makeCtx([
      {
        role: 'system',
        content: [{ type: 'text', text: 'See @config' }] as ContentPart[],
      },
      { role: 'user', content: 'hello' },
    ])
    ctx.request.messages[0]!._messageId = 'sys-parts-1'
    await mw(ctx)
    expect(ctx.request.messages[0]!._messageId).toBe('sys-parts-1')
    const parts = ctx.request.messages[0]!.content as ContentPart[]
    expect(parts).toHaveLength(2)
  })
})

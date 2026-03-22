import { describe, it, expect } from 'bun:test'
import { createToolFilterMiddleware, createRecentlyUsedFilter } from '@chinmaymk/ra'
import type { ITool, ModelCallContext } from '@chinmaymk/ra'
import { makeModelCallCtx } from './test-utils'

function makeTool(name: string): ITool {
  return { name, description: `${name} tool`, inputSchema: {}, execute: async () => 'ok' }
}

describe('createToolFilterMiddleware', () => {
  it('filters tools based on the filter function', async () => {
    const middleware = createToolFilterMiddleware((tool) => tool.name === 'keep')
    const ctx = makeModelCallCtx([{ role: 'user', content: 'hi' }])
    ctx.request.tools = [makeTool('keep'), makeTool('remove'), makeTool('also_remove')]

    await middleware(ctx)

    expect(ctx.request.tools).toHaveLength(1)
    expect(ctx.request.tools[0]!.name).toBe('keep')
  })

  it('does nothing when tools is empty', async () => {
    const middleware = createToolFilterMiddleware(() => false)
    const ctx = makeModelCallCtx([{ role: 'user', content: 'hi' }])
    ctx.request.tools = []

    await middleware(ctx)

    expect(ctx.request.tools).toHaveLength(0)
  })

  it('does nothing when tools is undefined', async () => {
    const middleware = createToolFilterMiddleware(() => false)
    const ctx = makeModelCallCtx([{ role: 'user', content: 'hi' }])
    ctx.request.tools = undefined

    await middleware(ctx)

    expect(ctx.request.tools).toBeUndefined()
  })

  it('passes context to filter function', async () => {
    let receivedCtx: ModelCallContext | undefined
    const middleware = createToolFilterMiddleware((_tool, ctx) => { receivedCtx = ctx; return true })
    const ctx = makeModelCallCtx([{ role: 'user', content: 'hi' }])
    ctx.request.tools = [makeTool('a')]

    await middleware(ctx)

    expect(receivedCtx).toBe(ctx)
  })
})

describe('createRecentlyUsedFilter', () => {
  it('allows all tools on first iteration', () => {
    const filter = createRecentlyUsedFilter({ baseTools: ['base'] })
    const ctx = makeModelCallCtx([{ role: 'user', content: 'hi' }])
    ctx.loop.iteration = 1

    expect(filter(makeTool('any_tool'), ctx)).toBe(true)
    expect(filter(makeTool('another'), ctx)).toBe(true)
  })

  it('restricts to base + recently used on subsequent iterations', () => {
    const filter = createRecentlyUsedFilter({ baseTools: ['base'], window: 3 })
    const messages = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'tc1', name: 'used_tool', arguments: '{}' }] },
      { role: 'tool' as const, content: 'ok', toolCallId: 'tc1' },
    ]
    const ctx = makeModelCallCtx(messages)
    ctx.loop.iteration = 2
    ctx.loop.messages = messages

    expect(filter(makeTool('base'), ctx)).toBe(true)
    expect(filter(makeTool('used_tool'), ctx)).toBe(true)
    expect(filter(makeTool('unused'), ctx)).toBe(false)
  })

  it('defaults to allowing all when no base tools and first iteration', () => {
    const filter = createRecentlyUsedFilter()
    const ctx = makeModelCallCtx([{ role: 'user', content: 'hi' }])
    ctx.loop.iteration = 1

    expect(filter(makeTool('anything'), ctx)).toBe(true)
  })
})

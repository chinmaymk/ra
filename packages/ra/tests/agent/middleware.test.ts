import { test, expect, describe, it } from 'bun:test'
import { runMiddlewareChain, mergeMiddleware, NoopLogger } from '@chinmaymk/ra'
import type { LoopContext } from '@chinmaymk/ra'

const logger = new NoopLogger()

function makeCtx(controller: AbortController): LoopContext {
  return {
    messages: [], iteration: 0, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, resumed: false,
    stop: () => controller.abort(),
    signal: controller.signal,
    logger,
  }
}

test('runs all handlers in order', async () => {
  const order: number[] = []
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  await runMiddlewareChain(ctx, [
    async (_c) => { order.push(1) },
    async (_c) => { order.push(2) },
  ])
  expect(order).toEqual([1, 2])
})

test('stops chain when ctx.stop() is called', async () => {
  const order: number[] = []
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  await runMiddlewareChain(ctx, [
    async (c) => { order.push(1); c.stop() },
    async (_c) => { order.push(2) },
  ])
  expect(order).toEqual([1])
})

test('skips all handlers if already aborted', async () => {
  const order: number[] = []
  const controller = new AbortController()
  controller.abort()
  const ctx = makeCtx(controller)
  await runMiddlewareChain(ctx, [
    async (_c) => { order.push(1) },
  ])
  expect(order).toEqual([])
})

test('empty chain resolves immediately', async () => {
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  await expect(runMiddlewareChain(ctx, [])).resolves.toBeUndefined()
})

test('handler error propagates and stops chain', async () => {
  const order: number[] = []
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  await expect(
    runMiddlewareChain(ctx, [
      async (_c) => { order.push(1); throw new Error('boom') },
      async (_c) => { order.push(2) },
    ])
  ).rejects.toThrow('boom')
  expect(order).toEqual([1])
})

test('skips slow middleware when timeout is set', async () => {
  const order: number[] = []
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  await runMiddlewareChain(ctx, [
    async () => { order.push(1) },
    async () => { await new Promise(r => setTimeout(r, 5000)); order.push(2) },
    async () => { order.push(3) },
  ], 50)
  expect(order).toEqual([1, 3])
})

describe('mergeMiddleware', () => {
  it('merges handlers from multiple layers in order', () => {
    const mw = mergeMiddleware(
      { beforeModelCall: [async () => {}] },
      { beforeModelCall: [async () => {}], afterModelResponse: [async () => {}] },
    )
    expect(mw.beforeModelCall).toHaveLength(2)
    expect(mw.afterModelResponse).toHaveLength(1)
  })

  it('skips undefined layers', () => {
    const mw = mergeMiddleware(undefined, { beforeModelCall: [async () => {}] }, undefined)
    expect(mw.beforeModelCall).toHaveLength(1)
  })

  it('returns empty object for no layers', () => {
    const mw = mergeMiddleware()
    expect(Object.keys(mw)).toHaveLength(0)
  })

  it('skips hooks with empty arrays', () => {
    const mw = mergeMiddleware({ beforeModelCall: [] }, { afterModelResponse: [async () => {}] })
    expect(mw.beforeModelCall).toBeUndefined()
    expect(mw.afterModelResponse).toHaveLength(1)
  })
})

test('timeout is per-middleware, not global — fast handlers still run', async () => {
  const order: number[] = []
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  // Three middlewares: fast, slow (times out), fast — both fast ones should run
  await runMiddlewareChain(ctx, [
    async () => { order.push(1) },
    async () => { await new Promise(r => setTimeout(r, 200)); order.push(2) },
    async () => { order.push(3) },
  ], 50)
  expect(order).toEqual([1, 3])
})


import { test, expect } from 'bun:test'
import { runMiddlewareChain } from '../../src/agent/middleware'
import type { LoopContext } from '../../src/agent/types'

function makeCtx(controller: AbortController): LoopContext {
  return {
    messages: [], iteration: 0, maxIterations: 10, sessionId: 'test',
    stop: () => controller.abort(),
    signal: controller.signal,
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

test('stop() is idempotent — calling multiple times does not throw', async () => {
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  await runMiddlewareChain(ctx, [
    async (c) => { c.stop(); c.stop(); c.stop() },
  ])
  expect(ctx.signal.aborted).toBe(true)
})

test('signal reflects aborted state after stop()', async () => {
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  expect(ctx.signal.aborted).toBe(false)
  await runMiddlewareChain(ctx, [async (c) => { c.stop() }])
  expect(ctx.signal.aborted).toBe(true)
})

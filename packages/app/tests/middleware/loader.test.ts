import { test, expect } from 'bun:test'
import { loadMiddleware } from '../../src/middleware/loader'
import { defaultConfig } from '../../src/config/defaults'
import type { RaConfig } from '../../src/config/types'
import path from 'path'

const cwd = path.join(import.meta.dir, 'fixtures')

/** Build a config with custom middleware entries under agent.middleware. */
function withMiddleware(middleware: Record<string, string[]>): RaConfig {
  return { ...defaultConfig, agent: { ...defaultConfig.agent, middleware } }
}

test('loads inline middleware expression', async () => {
  const config = withMiddleware({
    beforeLoopBegin: ['async (ctx) => { (ctx as any).__hit = true }'],
  })
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
})

test('loads file-based middleware', async () => {
  const config = withMiddleware({
    beforeLoopBegin: ['./sample-middleware.js'],
  })
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
})

test('warns and skips unknown hook names', async () => {
  const config = withMiddleware({
    unknownHook: ['async (ctx) => {}'],
  })
  const mw = await loadMiddleware(config, cwd)
  expect((mw as any).unknownHook).toBeUndefined()
})

test('throws on bad inline expression', async () => {
  const config = withMiddleware({
    beforeLoopBegin: ['not valid js %%%'],
  })
  await expect(loadMiddleware(config, cwd)).rejects.toThrow()
})

test('throws on missing file', async () => {
  const config = withMiddleware({
    beforeLoopBegin: ['./nonexistent.js'],
  })
  await expect(loadMiddleware(config, cwd)).rejects.toThrow()
})

test('multiple entries on same hook all resolve', async () => {
  const config = withMiddleware({
    beforeLoopBegin: [
      './sample-middleware.js',
      'async (ctx) => {}',
    ],
  })
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(2)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
  expect(typeof mw.beforeLoopBegin![1]).toBe('function')
})

test('multiple hooks each get their own array', async () => {
  const config = withMiddleware({
    beforeLoopBegin: ['async (ctx) => {}'],
    afterLoopComplete: ['async (ctx) => {}', 'async (ctx) => {}'],
  })
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(mw.afterLoopComplete).toHaveLength(2)
})

test('empty config.middleware returns empty object', async () => {
  const config = withMiddleware({})
  const mw = await loadMiddleware(config, process.cwd())
  expect(Object.keys(mw)).toHaveLength(0)
})

test('inline TypeScript expression with type annotation works', async () => {
  const config = withMiddleware({
    beforeLoopBegin: ['async (ctx: any) => { ctx.__tsHit = true }'],
  })
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
})

test('inline middleware expression is callable and receives ctx', async () => {
  const config = withMiddleware({
    beforeLoopBegin: [`async (ctx) => { ctx.__testMarker = 'called' }`],
  })
  const mw = await loadMiddleware(config, cwd)
  const fn = mw.beforeLoopBegin![0]!
  const fakeCtx: any = {}
  await fn(fakeCtx as any)
  expect(fakeCtx.__testMarker).toBe('called')
})

test('file middleware reads context properties', async () => {
  const config = withMiddleware({ beforeLoopBegin: ['./ctx-reader.ts'] })
  const mw = await loadMiddleware(config, cwd)
  const ctx: any = {
    iteration: 3, maxIterations: 10, sessionId: 'sess-abc',
    messages: [], stop: () => {}, drain: () => {}, signal: new AbortController().signal,
  }
  await mw.beforeLoopBegin![0]!(ctx)
  expect(ctx.__saw).toBe('iter=3,max=10,sid=sess-abc')
})

test('file middleware calls stop() and observes signal', async () => {
  const config = withMiddleware({ beforeLoopBegin: ['./ctx-stopper.ts'] })
  const mw = await loadMiddleware(config, cwd)
  const ac = new AbortController()
  const ctx: any = {
    iteration: 0, maxIterations: 1, sessionId: 's', messages: [],
    stop: () => ac.abort(), drain: () => {}, signal: ac.signal,
  }
  await mw.beforeLoopBegin![0]!(ctx)
  expect(ctx.__beforeStop).toBe(false)
  expect(ctx.__afterStop).toBe(true)
  expect(ac.signal.aborted).toBe(true)
})

test('file middleware mutates messages array', async () => {
  const config = withMiddleware({ beforeLoopBegin: ['./ctx-mutator.ts'] })
  const mw = await loadMiddleware(config, cwd)
  const messages: any[] = [{ role: 'user', content: 'original' }]
  const ctx: any = {
    iteration: 0, maxIterations: 1, sessionId: 's', messages,
    stop: () => {}, drain: () => {}, signal: new AbortController().signal,
  }
  await mw.beforeLoopBegin![0]!(ctx)
  expect(messages).toHaveLength(2)
  expect(messages[1].content).toBe('injected by middleware')
})

test('inline middleware reads nested loop context', async () => {
  const config = withMiddleware({
    beforeModelCall: ['async (ctx) => { ctx.__nested = ctx.loop.sessionId + ":" + ctx.loop.iteration }'],
  })
  const mw = await loadMiddleware(config, cwd)
  const ctx: any = {
    request: {}, loop: { sessionId: 'x', iteration: 5, messages: [], maxIterations: 10 },
    stop: () => {}, drain: () => {}, signal: new AbortController().signal,
  }
  await mw.beforeModelCall![0]!(ctx)
  expect(ctx.__nested).toBe('x:5')
})

test('tilde path expansion uses slice(2) so ~/file resolves to homedir/file', async () => {
  const { homedir } = await import('os')
  const { writeFileSync, rmSync } = await import('fs')
  const home = homedir()
  const tmpFile = path.join(home, '.ra-test-middleware-tilde.ts')
  writeFileSync(tmpFile, 'export default async function(ctx: any) { ctx.__tilde = true }')
  try {
    const config = withMiddleware({
      beforeLoopBegin: [`~/.ra-test-middleware-tilde.ts`],
    })
    const mw = await loadMiddleware(config, cwd)
    expect(typeof mw.beforeLoopBegin![0]).toBe('function')
    const ctx: any = {}
    await mw.beforeLoopBegin![0]!(ctx as any)
    expect(ctx.__tilde).toBe(true)
  } finally {
    rmSync(tmpFile, { force: true })
  }
})

test('throws with descriptive message on eval non-function', async () => {
  const config = withMiddleware({
    beforeLoopBegin: ['"just a string"'],
  })
  await expect(loadMiddleware(config, cwd)).rejects.toThrow(/function/)
})

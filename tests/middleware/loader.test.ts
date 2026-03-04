import { test, expect } from 'bun:test'
import { loadMiddleware } from '../../src/middleware/loader'
import { defaultConfig } from '../../src/config/defaults'
import path from 'path'

const cwd = path.join(import.meta.dir, 'fixtures')

test('loads inline middleware expression', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['async (ctx) => { (ctx as any).__hit = true }'],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
})

test('loads file-based middleware', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['./sample-middleware.js'],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
})

test('warns and skips unknown hook names', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      unknownHook: ['async (ctx) => {}'],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect((mw as any).unknownHook).toBeUndefined()
})

test('throws on bad inline expression', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['not valid js %%%'],
    },
  }
  await expect(loadMiddleware(config, cwd)).rejects.toThrow()
})

test('throws on missing file', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['./nonexistent.js'],
    },
  }
  await expect(loadMiddleware(config, cwd)).rejects.toThrow()
})

test('multiple entries on same hook all resolve', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: [
        './sample-middleware.js',
        'async (ctx) => {}',
      ],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(2)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
  expect(typeof mw.beforeLoopBegin![1]).toBe('function')
})

test('multiple hooks each get their own array', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['async (ctx) => {}'],
      afterLoopComplete: ['async (ctx) => {}', 'async (ctx) => {}'],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(mw.afterLoopComplete).toHaveLength(2)
})

test('empty config.middleware returns empty object', async () => {
  const config = { ...defaultConfig, middleware: {} }
  const mw = await loadMiddleware(config, process.cwd())
  expect(Object.keys(mw)).toHaveLength(0)
})

test('inline TypeScript expression with type annotation works', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['async (ctx: any) => { ctx.__tsHit = true }'],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
})

test('inline middleware expression is callable and receives ctx', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: [`async (ctx) => { ctx.__testMarker = 'called' }`],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  const fn = mw.beforeLoopBegin![0]!
  const fakeCtx: any = {}
  await fn(fakeCtx as any)
  expect(fakeCtx.__testMarker).toBe('called')
})

test('throws with descriptive message on eval non-function', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['"just a string"'],
    },
  }
  await expect(loadMiddleware(config, cwd)).rejects.toThrow(/function/)
})

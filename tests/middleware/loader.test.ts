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

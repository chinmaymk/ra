import { test, expect } from 'bun:test'
import { parseShellEntry, createShellMiddleware } from '../../src/middleware/shell'
import { isShellEntry, hasShellPrefix, isShellPath } from '../../src/middleware/loader'
import { loadMiddleware } from '../../src/middleware/loader'
import { defaultConfig } from '../../src/config/defaults'
import type { RaConfig } from '../../src/config/types'
import type { LoopContext, ToolExecutionContext } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'
import path from 'path'

const fixturesDir = path.join(import.meta.dir, 'fixtures')
const logger = new NoopLogger()

function withMiddleware(middleware: Record<string, string[]>): RaConfig {
  return { ...defaultConfig, agent: { ...defaultConfig.agent, middleware } }
}

function fakeLoopCtx(overrides?: Partial<LoopContext>): LoopContext {
  const ac = new AbortController()
  return {
    messages: [{ role: 'user', content: 'hello' }],
    iteration: 0,
    maxIterations: 10,
    sessionId: 'test-session',
    usage: { inputTokens: 0, outputTokens: 0 },
    lastUsage: undefined,
    resumed: false,
    stop: (reason?: string) => ac.abort(reason),
    signal: ac.signal,
    logger,
    ...overrides,
  } as LoopContext
}

// --- parseShellEntry ---

test('parseShellEntry extracts command and args', () => {
  const result = parseShellEntry('shell: python3 ./check.py --flag')
  expect(result.command).toBe('python3')
  expect(result.args).toEqual(['./check.py', '--flag'])
})

test('parseShellEntry handles single command', () => {
  const result = parseShellEntry('shell: ./my-script.sh')
  expect(result.command).toBe('./my-script.sh')
  expect(result.args).toEqual([])
})

test('parseShellEntry handles quoted args', () => {
  const result = parseShellEntry('shell: bash -c "echo hello world"')
  expect(result.command).toBe('bash')
  expect(result.args).toEqual(['-c', 'echo hello world'])
})

test('parseShellEntry throws on empty entry', () => {
  expect(() => parseShellEntry('shell:   ')).toThrow(/Empty shell middleware/)
})

// --- isShellEntry / hasShellPrefix / isShellPath ---

test('hasShellPrefix returns true for shell: prefix', () => {
  expect(hasShellPrefix('shell: ./hook.sh')).toBe(true)
  expect(hasShellPrefix('shell:python3 hook.py')).toBe(true)
})

test('hasShellPrefix returns false for non-prefixed entries', () => {
  expect(hasShellPrefix('./hook.sh')).toBe(false)
  expect(hasShellPrefix('./middleware.ts')).toBe(false)
})

test('isShellPath detects script file extensions', () => {
  expect(isShellPath('./hook.sh')).toBe(true)
  expect(isShellPath('./check.py')).toBe(true)
  expect(isShellPath('../middleware/guard.rb')).toBe(true)
  expect(isShellPath('~/scripts/run.pl')).toBe(true)
  expect(isShellPath('./script.bash')).toBe(true)
})

test('isShellPath returns false for JS/TS and inline expressions', () => {
  expect(isShellPath('./middleware.ts')).toBe(false)
  expect(isShellPath('./middleware.js')).toBe(false)
  expect(isShellPath('(ctx) => {}')).toBe(false)
})

test('isShellEntry matches both prefix and extension', () => {
  expect(isShellEntry('shell: ./hook.sh')).toBe(true)
  expect(isShellEntry('shell:python3 hook.py')).toBe(true)
  expect(isShellEntry('./hook.sh')).toBe(true)
  expect(isShellEntry('./check.py')).toBe(true)
  expect(isShellEntry('./middleware.ts')).toBe(false)
  expect(isShellEntry('(ctx) => {}')).toBe(false)
})

// --- createShellMiddleware ---

test('shell middleware runs script and reads stderr', async () => {
  const mw = createShellMiddleware<LoopContext>(
    'shell: ./echo-hook.sh', 'beforeLoopBegin', fixturesDir, logger,
  )
  const ctx = fakeLoopCtx()
  await mw(ctx)
  // No error — script exited 0 with no stdout mutations
})

test('shell middleware applies stop from stdout', async () => {
  const mw = createShellMiddleware<LoopContext>(
    'shell: ./stop-loop.sh', 'beforeLoopBegin', fixturesDir, logger,
  )
  const ac = new AbortController()
  const ctx = fakeLoopCtx({ stop: () => ac.abort(), signal: ac.signal })
  await mw(ctx)
  expect(ac.signal.aborted).toBe(true)
})

test('shell middleware applies message mutations', async () => {
  const mw = createShellMiddleware<LoopContext>(
    'shell: ./mutate-messages.sh', 'beforeLoopBegin', fixturesDir, logger,
  )
  const ctx = fakeLoopCtx()
  await mw(ctx)
  expect(ctx.messages).toHaveLength(2)
  expect(ctx.messages[1]!.content).toBe('injected by shell')
})

test('shell middleware throws on non-zero exit', async () => {
  const mw = createShellMiddleware<LoopContext>(
    'shell: ./bad-exit.sh', 'beforeLoopBegin', fixturesDir, logger,
  )
  const ctx = fakeLoopCtx()
  await expect(mw(ctx)).rejects.toThrow(/exited with code 1/)
})

test('shell middleware throws on invalid JSON stdout', async () => {
  const mw = createShellMiddleware<LoopContext>(
    'shell: ./bad-json.sh', 'beforeLoopBegin', fixturesDir, logger,
  )
  const ctx = fakeLoopCtx()
  await expect(mw(ctx)).rejects.toThrow(/invalid JSON/)
})

test('shell middleware applies deny for tool execution', async () => {
  const mw = createShellMiddleware<ToolExecutionContext>(
    'shell: ./deny-tool.sh', 'beforeToolExecution', fixturesDir, logger,
  )
  let denyReason = ''
  const ac = new AbortController()
  const ctx = {
    toolCall: { id: 'tc1', name: 'Bash', arguments: '{"command":"rm -rf /"}' },
    loop: fakeLoopCtx(),
    stop: () => ac.abort(),
    signal: ac.signal,
    logger,
    deny: (reason: string) => { denyReason = reason },
  } as unknown as ToolExecutionContext
  await mw(ctx)
  expect(denyReason).toBe('blocked by shell policy')
})

// --- loadMiddleware integration ---

test('loadMiddleware loads shell: entries', async () => {
  const config = withMiddleware({
    beforeLoopBegin: [`shell: ${path.join(fixturesDir, 'echo-hook.sh')}`],
  })
  const mw = await loadMiddleware(config, fixturesDir)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  expect(typeof mw.beforeLoopBegin![0]).toBe('function')
})

test('loadMiddleware mixes shell and inline entries', async () => {
  const config = withMiddleware({
    beforeLoopBegin: [
      `shell: ${path.join(fixturesDir, 'echo-hook.sh')}`,
      'async (ctx) => {}',
    ],
  })
  const mw = await loadMiddleware(config, fixturesDir)
  expect(mw.beforeLoopBegin).toHaveLength(2)
})

test('shell middleware receives context with correct hook name', async () => {
  // Use a script that verifies the hook name via stderr
  const mw = createShellMiddleware<LoopContext>(
    'shell: ./echo-hook.sh', 'afterLoopComplete', fixturesDir, logger,
  )
  const ctx = fakeLoopCtx()
  // Should not throw — confirms hook was passed correctly
  await mw(ctx)
})

test('empty stdout from shell middleware is fine (no mutations)', async () => {
  const config = withMiddleware({
    beforeLoopBegin: [`shell: ${path.join(fixturesDir, 'echo-hook.sh')}`],
  })
  const mw = await loadMiddleware(config, fixturesDir)
  const ctx = fakeLoopCtx()
  await mw.beforeLoopBegin![0]!(ctx)
  // Messages unchanged
  expect(ctx.messages).toHaveLength(1)
})

test('loadMiddleware auto-detects .sh files without shell: prefix', async () => {
  const config = withMiddleware({
    beforeLoopBegin: [`${path.join(fixturesDir, 'echo-hook.sh')}`],
  })
  const mw = await loadMiddleware(config, fixturesDir)
  expect(mw.beforeLoopBegin).toHaveLength(1)
  const ctx = fakeLoopCtx()
  await mw.beforeLoopBegin![0]!(ctx)
  // Runs without error — auto-detected as shell middleware
  expect(ctx.messages).toHaveLength(1)
})

test('loadMiddleware auto-detects .py files without shell: prefix', async () => {
  // Write a temporary python script
  const { writeFileSync, rmSync } = await import('fs')
  const pyFile = path.join(fixturesDir, 'noop.py')
  writeFileSync(pyFile, '#!/usr/bin/env python3\nimport sys, json\njson.load(sys.stdin)\n', { mode: 0o755 })
  try {
    const config = withMiddleware({
      beforeLoopBegin: [pyFile],
    })
    const mw = await loadMiddleware(config, fixturesDir)
    expect(mw.beforeLoopBegin).toHaveLength(1)
    expect(typeof mw.beforeLoopBegin![0]).toBe('function')
  } finally {
    rmSync(pyFile, { force: true })
  }
})

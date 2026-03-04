# Middleware Config File Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to define agent loop middleware in `ra.config.yml` as file paths or inline JS expressions, with `ctx.stop()` (backed by `AbortSignal`) to interrupt the loop.

**Architecture:** Change `Middleware<T>` from `(ctx, next)` to `(ctx) => Promise<void>`. Add an `AbortController` per loop run, expose `stop()` and `signal` on all context objects. Add a `loadMiddleware` loader that resolves file/inline entries from `config.middleware` and returns a `MiddlewareConfig`. Wire it into all `AgentLoop` construction sites in `src/index.ts`.

**Tech Stack:** Bun, TypeScript, `bun test`, dynamic `import()`, `(0, eval)()`

---

### Task 1: Update Middleware Signature and Context Types

**Files:**
- Modify: `src/agent/types.ts`

The `Middleware<T>` type currently takes `(ctx, next)`. We drop `next` and add `stop()` + `signal` to all context types. Since all contexts include or compose `LoopContext`, we add the fields there and propagate.

**Step 1: Open `src/agent/types.ts` and replace its contents**

```ts
import type { IToolCall, IToolResult, StreamChunk, IMessage, ChatRequest } from '../providers/types'

export interface LoopContext {
  messages: IMessage[]
  iteration: number
  maxIterations: number
  sessionId: string
  stop: () => void
  signal: AbortSignal
}

export interface ModelCallContext {
  request: ChatRequest
  loop: LoopContext
  stop: () => void
  signal: AbortSignal
}

export interface StreamChunkContext {
  chunk: StreamChunk
  loop: LoopContext
  stop: () => void
  signal: AbortSignal
}

export interface ToolExecutionContext {
  toolCall: IToolCall
  loop: LoopContext
  stop: () => void
  signal: AbortSignal
}

export interface ToolResultContext {
  toolCall: IToolCall
  result: IToolResult
  loop: LoopContext
  stop: () => void
  signal: AbortSignal
}

export interface ErrorContext {
  error: Error
  loop: LoopContext
  phase: 'model_call' | 'tool_execution' | 'stream'
  stop: () => void
  signal: AbortSignal
}

export type Middleware<T> = (ctx: T) => Promise<void>

export interface MiddlewareConfig {
  beforeLoopBegin: Middleware<LoopContext>[]
  beforeModelCall: Middleware<ModelCallContext>[]
  onStreamChunk: Middleware<StreamChunkContext>[]
  beforeToolExecution: Middleware<ToolExecutionContext>[]
  afterToolExecution: Middleware<ToolResultContext>[]
  afterModelResponse: Middleware<ModelCallContext>[]
  afterLoopIteration: Middleware<LoopContext>[]
  afterLoopComplete: Middleware<LoopContext>[]
  onError: Middleware<ErrorContext>[]
}
```

**Step 2: Check for TypeScript errors**

```bash
bun tsc --noEmit
```

Expected: errors in `src/agent/middleware.ts` and `src/agent/loop.ts` (they still use old signature). That's expected — fix in next tasks.

**Step 3: Commit**

```bash
git add src/agent/types.ts
git commit -m "refactor: drop next arg from Middleware, add stop/signal to all contexts"
```

---

### Task 2: Update runMiddlewareChain

**Files:**
- Modify: `src/agent/middleware.ts`

`runMiddlewareChain` currently does koa-style `next` chaining. Replace with sequential iteration that checks `signal.aborted` before each handler.

**Step 1: Write the failing test**

Create `tests/agent/middleware.test.ts`:

```ts
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
    async (c) => { order.push(1) },
    async (c) => { order.push(2) },
  ])
  expect(order).toEqual([1, 2])
})

test('stops chain when ctx.stop() is called', async () => {
  const order: number[] = []
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  await runMiddlewareChain(ctx, [
    async (c) => { order.push(1); c.stop() },
    async (c) => { order.push(2) },
  ])
  expect(order).toEqual([1])
})

test('skips all handlers if already aborted', async () => {
  const order: number[] = []
  const controller = new AbortController()
  controller.abort()
  const ctx = makeCtx(controller)
  await runMiddlewareChain(ctx, [
    async (c) => { order.push(1) },
  ])
  expect(order).toEqual([])
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/agent/middleware.test.ts
```

Expected: FAIL — `runMiddlewareChain` signature doesn't match yet.

**Step 3: Replace `src/agent/middleware.ts`**

```ts
import type { Middleware } from './types'

export async function runMiddlewareChain<T extends { signal: AbortSignal }>(
  ctx: T,
  chain: Middleware<T>[],
): Promise<void> {
  for (const mw of chain) {
    if (ctx.signal.aborted) break
    await mw(ctx)
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/agent/middleware.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/middleware.ts tests/agent/middleware.test.ts
git commit -m "refactor: sequential middleware chain with AbortSignal stop support"
```

---

### Task 3: Update AgentLoop to use AbortController

**Files:**
- Modify: `src/agent/loop.ts`

Create one `AbortController` per `run()` call. Attach `stop` and `signal` to every context object. Check `signal.aborted` after each `runMiddlewareChain` call to break the loop.

**Step 1: Write the failing test**

Create `tests/agent/loop-stop.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import type { IProvider, ChatRequest } from '../../src/providers/types'

// Minimal provider that returns text immediately
const mockProvider: IProvider = {
  async *stream(req: ChatRequest) {
    yield { type: 'text' as const, delta: 'hello' }
    yield { type: 'done' as const }
  }
}

test('middleware can stop the loop via ctx.stop()', async () => {
  const tools = new ToolRegistry()
  let iterations = 0

  const loop = new AgentLoop({
    provider: mockProvider,
    tools,
    model: 'test',
    maxIterations: 5,
    middleware: {
      afterLoopIteration: [
        async (ctx) => {
          iterations++
          if (iterations >= 2) ctx.stop()
        }
      ]
    }
  })

  const result = await loop.run([{ role: 'user', content: 'hi' }])
  // Should stop after 2 iterations, not run all 5
  expect(result.iterations).toBe(2)
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/agent/loop-stop.test.ts
```

Expected: FAIL — loop doesn't support stop yet.

**Step 3: Rewrite `src/agent/loop.ts`**

```ts
import type { IProvider, IMessage, IToolCall } from '../providers/types'
import type { MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext } from './types'
import { runMiddlewareChain } from './middleware'
import type { ToolRegistry } from './tool-registry'
import { randomUUID } from 'crypto'

export interface AgentLoopOptions {
  provider: IProvider
  tools: ToolRegistry
  maxIterations?: number
  model?: string
  middleware?: Partial<MiddlewareConfig>
  sessionId?: string
}

export interface LoopResult {
  messages: IMessage[]
  iterations: number
}

const EMPTY_MW: MiddlewareConfig = {
  beforeLoopBegin: [], beforeModelCall: [], onStreamChunk: [],
  beforeToolExecution: [], afterToolExecution: [], afterModelResponse: [],
  afterLoopIteration: [], afterLoopComplete: [], onError: [],
}

export class AgentLoop {
  private provider: IProvider
  private tools: ToolRegistry
  private maxIterations: number
  private model: string
  private middleware: MiddlewareConfig
  private sessionId: string

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider
    this.tools = options.tools
    this.maxIterations = options.maxIterations ?? 10
    this.model = options.model ?? 'default'
    this.sessionId = options.sessionId ?? randomUUID()
    this.middleware = { ...EMPTY_MW, ...options.middleware }
  }

  async run(initialMessages: IMessage[]): Promise<LoopResult> {
    const messages: IMessage[] = [...initialMessages]
    let iterations = 0
    const controller = new AbortController()
    const { signal } = controller
    const stop = () => controller.abort()

    const loopCtx = (): LoopContext => ({
      messages, iteration: iterations, maxIterations: this.maxIterations,
      sessionId: this.sessionId, stop, signal,
    })

    const withStop = <T>(ctx: T): T & { stop: () => void; signal: AbortSignal } =>
      Object.assign(ctx as object, { stop, signal }) as T & { stop: () => void; signal: AbortSignal }

    try {
      await runMiddlewareChain(loopCtx(), this.middleware.beforeLoopBegin)
      if (signal.aborted) return { messages, iterations }

      while (iterations < this.maxIterations) {
        iterations++

        const request = { model: this.model, messages: [...messages], tools: this.tools.all() }
        const modelCallCtx: ModelCallContext = withStop({ request, loop: loopCtx() })
        await runMiddlewareChain(modelCallCtx, this.middleware.beforeModelCall)
        if (signal.aborted) break

        let textAccumulator = ''
        const toolCallBuf: { id: string; name: string; argsRaw: string }[] = []

        for await (const chunk of this.provider.stream(request)) {
          if (chunk.type === 'text') {
            await runMiddlewareChain(withStop<StreamChunkContext>({ chunk, loop: loopCtx() }), this.middleware.onStreamChunk)
            if (signal.aborted) break
            textAccumulator += chunk.delta
          } else if (chunk.type === 'tool_call_start') {
            toolCallBuf.push({ id: chunk.id, name: chunk.name, argsRaw: '' })
          } else if (chunk.type === 'tool_call_delta') {
            const tc = toolCallBuf.find(t => t.id === chunk.id)
            if (tc) tc.argsRaw += chunk.argsDelta
          } else if (chunk.type === 'done') {
            break
          }
        }

        if (signal.aborted) break

        const toolCalls: IToolCall[] = toolCallBuf.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.argsRaw }))
        messages.push({ role: 'assistant', content: textAccumulator, ...(toolCalls.length && { toolCalls }) })
        await runMiddlewareChain(modelCallCtx, this.middleware.afterModelResponse)
        if (signal.aborted) break

        if (toolCalls.length) {
          const results = await Promise.allSettled(
            toolCalls.map(async tc => {
              await runMiddlewareChain(withStop<ToolExecutionContext>({ toolCall: tc, loop: loopCtx() }), this.middleware.beforeToolExecution)
              if (signal.aborted) return ''
              let input: unknown
              try { input = JSON.parse(tc.arguments || '{}') } catch { input = {} }
              const value = await this.tools.execute(tc.name, input)
              const content = typeof value === 'string' ? value : JSON.stringify(value)
              await runMiddlewareChain(withStop<ToolResultContext>({ toolCall: tc, result: { toolCallId: tc.id, content, isError: false }, loop: loopCtx() }), this.middleware.afterToolExecution)
              return content
            })
          )

          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i]!
            const settled = results[i]!
            const isError = settled.status === 'rejected'
            const content = isError
              ? (settled.reason instanceof Error ? settled.reason.message : String(settled.reason))
              : settled.value
            messages.push({ role: 'tool', content, toolCallId: tc.id, ...(isError && { isError: true }) })
          }
        }

        await runMiddlewareChain(loopCtx(), this.middleware.afterLoopIteration)
        if (signal.aborted) break
        if (!toolCalls.length) break
      }

      if (!signal.aborted) {
        await runMiddlewareChain(loopCtx(), this.middleware.afterLoopComplete)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await runMiddlewareChain(withStop<ErrorContext>({ error, loop: loopCtx(), phase: 'model_call' }), this.middleware.onError)
      throw err
    }

    return { messages, iterations }
  }
}
```

**Step 4: Run tests**

```bash
bun test tests/agent/
```

Expected: all PASS

**Step 5: Check TypeScript**

```bash
bun tsc --noEmit
```

Expected: no errors

**Step 6: Commit**

```bash
git add src/agent/loop.ts tests/agent/loop-stop.test.ts
git commit -m "feat: AbortController-based loop stop in AgentLoop, wire stop/signal into all contexts"
```

---

### Task 4: Middleware Loader

**Files:**
- Create: `src/middleware/loader.ts`

This module reads `config.middleware` (a `Record<string, string[]>`) and resolves each entry to a `Middleware<T>` function. It detects file paths vs inline expressions and loads them accordingly.

**Step 1: Write the failing test**

Create `tests/middleware/loader.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { loadMiddleware } from '../../src/middleware/loader'
import type { RaConfig } from '../../src/config/types'
import { defaultConfig } from '../../src/config/defaults'
import path from 'path'

const cwd = path.join(import.meta.dir, 'fixtures')

test('loads inline middleware expression', async () => {
  const config: RaConfig = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['async (ctx) => { ctx.messages.push({ role: "user", content: "injected" }) }'],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
})

test('loads file-based middleware', async () => {
  const config: RaConfig = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['./sample-middleware.js'],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect(mw.beforeLoopBegin).toHaveLength(1)
})

test('warns and skips unknown hook names', async () => {
  const config: RaConfig = {
    ...defaultConfig,
    middleware: {
      unknownHook: ['async (ctx) => {}'],
    },
  }
  const mw = await loadMiddleware(config, cwd)
  expect(Object.keys(mw)).not.toContain('unknownHook')
})

test('throws on bad inline expression', async () => {
  const config: RaConfig = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['not valid js %%%'],
    },
  }
  await expect(loadMiddleware(config, cwd)).rejects.toThrow()
})

test('throws on missing file', async () => {
  const config: RaConfig = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: ['./nonexistent.js'],
    },
  }
  await expect(loadMiddleware(config, cwd)).rejects.toThrow()
})
```

Create `tests/middleware/fixtures/sample-middleware.js`:

```js
export default async function(ctx) {
  // no-op test middleware
}
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/middleware/loader.test.ts
```

Expected: FAIL — module doesn't exist yet.

**Step 3: Create `src/middleware/loader.ts`**

```ts
import { join, isAbsolute } from 'path'
import type { RaConfig } from '../config/types'
import type { MiddlewareConfig, Middleware } from '../agent/types'

const VALID_HOOKS = new Set<string>([
  'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk',
  'beforeToolExecution', 'afterToolExecution', 'afterModelResponse',
  'afterLoopIteration', 'afterLoopComplete', 'onError',
])

function isFilePath(s: string): boolean {
  return s.startsWith('./') || s.startsWith('../') || s.startsWith('/') || s.startsWith('~') ||
    s.endsWith('.js') || s.endsWith('.ts')
}

async function loadOne<T>(entry: string, cwd: string): Promise<Middleware<T>> {
  if (isFilePath(entry)) {
    const resolved = isAbsolute(entry) ? entry : join(cwd, entry)
    const mod = await import(resolved)
    if (typeof mod.default !== 'function') {
      throw new Error(`Middleware file "${resolved}" must export a default function`)
    }
    return mod.default as Middleware<T>
  }
  // Inline expression
  let fn: unknown
  try {
    fn = (0, eval)('(' + entry + ')')
  } catch (err) {
    throw new Error(`Failed to parse inline middleware expression: ${err instanceof Error ? err.message : String(err)}\n  Expression: ${entry}`)
  }
  if (typeof fn !== 'function') {
    throw new Error(`Inline middleware expression must evaluate to a function. Got: ${typeof fn}`)
  }
  return fn as Middleware<T>
}

export async function loadMiddleware(
  config: RaConfig,
  cwd: string,
): Promise<Partial<MiddlewareConfig>> {
  const result: Partial<MiddlewareConfig> = {}

  for (const [hook, entries] of Object.entries(config.middleware ?? {})) {
    if (!VALID_HOOKS.has(hook)) {
      console.warn(`[ra] Unknown middleware hook "${hook}" — skipping`)
      continue
    }
    const fns = await Promise.all(entries.map(e => loadOne(e, cwd)))
    ;(result as Record<string, unknown[]>)[hook] = fns
  }

  return result
}
```

**Step 4: Run tests**

```bash
bun test tests/middleware/loader.test.ts
```

Expected: all PASS

**Step 5: Commit**

```bash
git add src/middleware/loader.ts tests/middleware/loader.test.ts tests/middleware/fixtures/sample-middleware.js
git commit -m "feat: middleware loader — resolves file paths and inline expressions from config"
```

---

### Task 5: Wire loadMiddleware into src/index.ts

**Files:**
- Modify: `src/index.ts`

Call `loadMiddleware` after `loadConfig` and merge it into every `AgentLoop` construction. There are four call sites: `mcpHandler`, `runCli`, HTTP server, and REPL.

**Step 1: Note the four AgentLoop construction sites in `src/index.ts`**

- Line ~124: `mcpHandler` (inline `new AgentLoop`)
- Line ~168: `runCli` (passes `middleware` option if available)
- Line ~182: `HttpServer` constructor
- Line ~196: `Repl` constructor

Open the relevant interface files to check if they accept `middleware`:

```bash
grep -n "middleware\|AgentLoop" src/interfaces/cli.ts src/interfaces/repl.ts src/interfaces/http.ts
```

**Step 2: Add `middleware` to interface option types and forward it**

For each of `src/interfaces/cli.ts`, `src/interfaces/repl.ts`, `src/interfaces/http.ts`:
- Add `middleware?: Partial<MiddlewareConfig>` to their options interface
- Pass it through when constructing `AgentLoop`

Check each file first — read before editing.

**Step 3: Update `src/index.ts`**

After the `loadConfig` call, add:

```ts
import { loadMiddleware } from './middleware/loader'
// ...
const middleware = await loadMiddleware(config, process.cwd())
```

Then pass `middleware` to all four `AgentLoop`/interface construction sites.

**Step 4: Run all tests**

```bash
bun test
```

Expected: all PASS

**Step 5: TypeScript check**

```bash
bun tsc --noEmit
```

Expected: no errors

**Step 6: Commit**

```bash
git add src/index.ts src/interfaces/cli.ts src/interfaces/repl.ts src/interfaces/http.ts
git commit -m "feat: wire loadMiddleware into all AgentLoop construction sites"
```

---

### Task 6: End-to-End Smoke Test

**Files:**
- Create: `tests/middleware/e2e.test.ts`

Verify the full pipeline: config with inline middleware → loadConfig + loadMiddleware → AgentLoop runs middleware.

**Step 1: Write the test**

```ts
import { test, expect } from 'bun:test'
import { loadMiddleware } from '../../src/middleware/loader'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import { defaultConfig } from '../../src/config/defaults'
import type { IProvider, ChatRequest } from '../../src/providers/types'

const mockProvider: IProvider = {
  async *stream(_req: ChatRequest) {
    yield { type: 'text' as const, delta: 'ok' }
    yield { type: 'done' as const }
  }
}

test('inline middleware is called during loop run', async () => {
  const called: string[] = []
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: [`async (ctx) => { globalThis.__mwTest = 'hit' }`],
    },
  }
  const mw = await loadMiddleware(config, process.cwd())
  const loop = new AgentLoop({
    provider: mockProvider,
    tools: new ToolRegistry(),
    model: 'test',
    middleware: mw,
  })
  await loop.run([{ role: 'user', content: 'hello' }])
  expect((globalThis as Record<string, unknown>).__mwTest).toBe('hit')
})

test('middleware can stop the loop early via ctx.stop()', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeModelCall: [`async (ctx) => { ctx.stop() }`],
    },
  }
  const mw = await loadMiddleware(config, process.cwd())
  const loop = new AgentLoop({
    provider: mockProvider,
    tools: new ToolRegistry(),
    model: 'test',
    maxIterations: 10,
    middleware: mw,
  })
  const result = await loop.run([{ role: 'user', content: 'hello' }])
  // Loop stopped before model call, so iterations = 1 but no assistant message added
  expect(result.iterations).toBe(1)
})
```

**Step 2: Run the test**

```bash
bun test tests/middleware/e2e.test.ts
```

Expected: PASS

**Step 3: Run the full test suite**

```bash
bun test
```

Expected: all PASS

**Step 4: Commit**

```bash
git add tests/middleware/e2e.test.ts
git commit -m "test: end-to-end middleware config loading and loop stop smoke test"
```

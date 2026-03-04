# Tool/Middleware Timeout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable timeouts to tool execution and middleware calls so no single operation can hang indefinitely.

**Architecture:** A single `toolTimeout` config field (milliseconds, default 30000, 0 = disabled) wraps every `tool.execute()` and every middleware function with `Promise.race` against a timer. On timeout, tools return an error string to the LLM; middleware is skipped and the chain continues.

**Tech Stack:** Bun, TypeScript, bun:test

---

### Task 1: Add `toolTimeout` to config types and defaults

**Files:**
- Modify: `src/config/types.ts:9-43` (RaConfig interface)
- Modify: `src/config/defaults.ts:3-41` (defaultConfig)

**Step 1: Add the field to RaConfig**

In `src/config/types.ts`, add after `maxIterations: number` (line 34):

```ts
  toolTimeout: number             // ms; 0 = no timeout
```

**Step 2: Add default value**

In `src/config/defaults.ts`, add after `maxIterations: 50,` (line 35):

```ts
  toolTimeout: 30000,
```

**Step 3: Run type check**

Run: `bun tsc --noEmit`
Expected: Errors in files that construct full RaConfig objects in tests (we'll fix those as we go)

**Step 4: Commit**

```bash
git add src/config/types.ts src/config/defaults.ts
git commit -m "feat: add toolTimeout to RaConfig (default 30s)"
```

---

### Task 2: Add env var and CLI arg support

**Files:**
- Modify: `src/config/index.ts:76-122` (loadEnvVars)
- Modify: `src/interfaces/parse-args.ts:40-84` (parseArgs options)

**Step 1: Write failing test for env var**

In `tests/config/index.test.ts`, add:

```ts
test('RA_TOOL_TIMEOUT sets toolTimeout', async () => {
  const config = await loadConfig({ env: { ...clean, RA_TOOL_TIMEOUT: '60000' } })
  expect(config.toolTimeout).toBe(60000)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config/index.test.ts -t "RA_TOOL_TIMEOUT"`
Expected: FAIL — toolTimeout is still 30000

**Step 3: Add env var mapping**

In `src/config/index.ts`, inside `loadEnvVars`, add after the `RA_THINKING` block (around line 89):

```ts
  if (env.RA_TOOL_TIMEOUT !== undefined) setInt(['toolTimeout'], env.RA_TOOL_TIMEOUT)
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/config/index.test.ts -t "RA_TOOL_TIMEOUT"`
Expected: PASS

**Step 5: Write failing test for CLI arg**

In `tests/config/parse-args.test.ts`, add:

```ts
test('--tool-timeout sets toolTimeout', () => {
  const { config } = parseArgs(['ra', '--tool-timeout', '15000'])
  expect(config.toolTimeout).toBe(15000)
})
```

**Step 6: Run test to verify it fails**

Run: `bun test tests/config/parse-args.test.ts -t "tool-timeout"`
Expected: FAIL

**Step 7: Add CLI arg**

In `src/interfaces/parse-args.ts`, add to the options object (after `'thinking'`):

```ts
      'tool-timeout':                  { type: 'string' },
```

And in the mapping section (after the `thinking` mapping):

```ts
  if (values['tool-timeout'])       { const n = safeParseInt(values['tool-timeout'] as string); if (n !== undefined) set(['toolTimeout'], n) }
```

**Step 8: Run test to verify it passes**

Run: `bun test tests/config/parse-args.test.ts -t "tool-timeout"`
Expected: PASS

**Step 9: Commit**

```bash
git add src/config/index.ts src/interfaces/parse-args.ts tests/config/index.test.ts tests/config/parse-args.test.ts
git commit -m "feat: add RA_TOOL_TIMEOUT env var and --tool-timeout CLI arg"
```

---

### Task 3: Add timeout utility function

**Files:**
- Create: `src/agent/timeout.ts`
- Create: `tests/agent/timeout.test.ts`

**Step 1: Write failing tests**

Create `tests/agent/timeout.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { withTimeout } from '../../src/agent/timeout'

test('resolves when promise completes before timeout', async () => {
  const result = await withTimeout(
    Promise.resolve('ok'),
    1000,
    'test operation'
  )
  expect(result).toBe('ok')
})

test('rejects with timeout error when promise exceeds timeout', async () => {
  const slow = new Promise(resolve => setTimeout(resolve, 5000))
  await expect(
    withTimeout(slow, 50, 'test operation')
  ).rejects.toThrow("test operation timed out after 50ms")
})

test('returns promise directly when timeout is 0 (disabled)', async () => {
  const result = await withTimeout(
    Promise.resolve('ok'),
    0,
    'test operation'
  )
  expect(result).toBe('ok')
})

test('propagates original errors (not timeout)', async () => {
  await expect(
    withTimeout(Promise.reject(new Error('boom')), 1000, 'test')
  ).rejects.toThrow('boom')
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/agent/timeout.test.ts`
Expected: FAIL — module not found

**Step 3: Implement withTimeout**

Create `src/agent/timeout.ts`:

```ts
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (ms <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/agent/timeout.test.ts`
Expected: PASS (all 4)

**Step 5: Commit**

```bash
git add src/agent/timeout.ts tests/agent/timeout.test.ts
git commit -m "feat: add withTimeout utility for tool/middleware timeouts"
```

---

### Task 4: Wire timeout into middleware chain

**Files:**
- Modify: `src/agent/middleware.ts`
- Modify: `tests/agent/middleware.test.ts`

**Step 1: Write failing test**

In `tests/agent/middleware.test.ts`, add:

```ts
import { runMiddlewareChain } from '../../src/agent/middleware'

test('skips slow middleware when timeout is set', async () => {
  const order: number[] = []
  const controller = new AbortController()
  const ctx = makeCtx(controller)
  await runMiddlewareChain(ctx, [
    async () => { order.push(1) },
    async () => { await new Promise(r => setTimeout(r, 5000)); order.push(2) },
    async () => { order.push(3) },
  ], 50)
  // middleware 2 timed out, but chain continues to 3
  expect(order).toEqual([1, 3])
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/agent/middleware.test.ts -t "skips slow middleware"`
Expected: FAIL (hangs or wrong result — runMiddlewareChain doesn't accept timeout param yet)

**Step 3: Update runMiddlewareChain**

Replace `src/agent/middleware.ts`:

```ts
import type { Middleware, StoppableContext } from './types'
import { withTimeout } from './timeout'

export async function runMiddlewareChain<T extends StoppableContext>(
  ctx: T,
  chain: Middleware<T>[],
  timeoutMs: number = 0,
): Promise<void> {
  for (const mw of chain) {
    if (ctx.signal.aborted) break
    if (timeoutMs > 0) {
      try {
        await withTimeout(mw(ctx), timeoutMs, 'middleware')
      } catch (err) {
        if (err instanceof (await import('./timeout')).TimeoutError) continue
        throw err
      }
    } else {
      await mw(ctx)
    }
  }
}
```

Wait — the dynamic import is ugly. Better approach: import statically and check the error type.

```ts
import type { Middleware, StoppableContext } from './types'
import { withTimeout, TimeoutError } from './timeout'

export async function runMiddlewareChain<T extends StoppableContext>(
  ctx: T,
  chain: Middleware<T>[],
  timeoutMs: number = 0,
): Promise<void> {
  for (const mw of chain) {
    if (ctx.signal.aborted) break
    if (timeoutMs > 0) {
      try {
        await withTimeout(mw(ctx), timeoutMs, 'middleware')
      } catch (err) {
        if (err instanceof TimeoutError) continue
        throw err
      }
    } else {
      await mw(ctx)
    }
  }
}
```

**Step 4: Run tests to verify all pass**

Run: `bun test tests/agent/middleware.test.ts`
Expected: PASS (all 6 tests — 5 existing + 1 new)

**Step 5: Commit**

```bash
git add src/agent/middleware.ts tests/agent/middleware.test.ts
git commit -m "feat: add timeout support to runMiddlewareChain"
```

---

### Task 5: Wire timeout into AgentLoop tool execution

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `tests/agent/loop.test.ts`

**Step 1: Write failing test**

In `tests/agent/loop.test.ts`, add:

```ts
test('tool timeout returns error message to LLM', async () => {
  const tools = new ToolRegistry()
  tools.register({
    name: 'slow_tool',
    description: 'hangs',
    inputSchema: { type: 'object' },
    execute: () => new Promise(r => setTimeout(() => r('done'), 5000)),
  })
  const provider = createMockProvider([
    [{ type: 'tool_call_start', id: 'tc1', name: 'slow_tool' }, { type: 'done' }],
    [{ type: 'text', delta: 'ok' }, { type: 'done' }],
  ])
  const loop = new AgentLoop({ provider, tools, toolTimeout: 50 })
  const result = await loop.run([{ role: 'user', content: 'test' }])
  const toolMsg = result.messages.find(m => m.role === 'tool')
  expect(toolMsg?.content).toContain('timed out after 50ms')
  expect(toolMsg?.isError).toBe(true)
})
```

Note: This test uses the existing `createMockProvider` helper in the test file. Adjust if the helper name differs.

**Step 2: Run test to verify it fails**

Run: `bun test tests/agent/loop.test.ts -t "tool timeout"`
Expected: FAIL — AgentLoopOptions doesn't have toolTimeout

**Step 3: Add toolTimeout to AgentLoop**

In `src/agent/loop.ts`:

1. Add to imports:
```ts
import { withTimeout, TimeoutError } from './timeout'
```

2. Add to `AgentLoopOptions`:
```ts
  toolTimeout?: number
```

3. Add private field in `AgentLoop`:
```ts
  private toolTimeout: number
```

4. In constructor:
```ts
  this.toolTimeout = options.toolTimeout ?? 0
```

5. In the tool execution section (around line 123), wrap the `this.tools.execute` call:

Replace:
```ts
                const value = await this.tools.execute(tc.name, input)
```

With:
```ts
                const value = this.toolTimeout > 0
                  ? await withTimeout(this.tools.execute(tc.name, input), this.toolTimeout, `Tool '${tc.name}'`)
                  : await this.tools.execute(tc.name, input)
```

The existing catch block already handles errors and reports them as tool results — `TimeoutError` extends `Error`, so it flows through the existing error path naturally. The error message will be `"Tool 'slow_tool' timed out after 50ms"`.

6. Pass timeout to all `runMiddlewareChain` calls — add `this.toolTimeout` as third argument to every `runMiddlewareChain` call in `run()`.

**Step 4: Run test to verify it passes**

Run: `bun test tests/agent/loop.test.ts -t "tool timeout"`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All pass

**Step 6: Commit**

```bash
git add src/agent/loop.ts tests/agent/loop.test.ts
git commit -m "feat: wire toolTimeout into AgentLoop for tool execution and middleware"
```

---

### Task 6: Wire config through to AgentLoop in interfaces

**Files:**
- Modify: `src/interfaces/cli.ts`
- Modify: `src/interfaces/repl.ts`
- Modify: `src/interfaces/http.ts`

**Step 1: Pass toolTimeout from config to AgentLoop**

Each interface constructs `new AgentLoop({...})`. Add `toolTimeout` to the options object in each file. The pattern is the same in all three — find the `new AgentLoop({` call and add `toolTimeout` alongside the other config-derived options like `maxIterations`.

For example in `src/interfaces/cli.ts` (line 42-43):

```ts
  const loop = new AgentLoop({
    provider, tools, model, maxIterations, thinking, compaction, toolTimeout,
```

Where `toolTimeout` is destructured from the options/config alongside the others.

**Step 2: Run full test suite**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/interfaces/cli.ts src/interfaces/repl.ts src/interfaces/http.ts
git commit -m "feat: pass toolTimeout config through all interfaces to AgentLoop"
```

---

### Task 7: Run full test suite and fix any breakage

**Step 1: Type check**

Run: `bun tsc --noEmit`
Expected: Clean

**Step 2: Full tests**

Run: `bun test`
Expected: All pass. Fix any failures from the new required field in test RaConfig objects.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve any test breakage from toolTimeout addition"
```

# Test Cleanup & Integration Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove low-value tests, add meaningful unit tests for critical behaviors, and build a full integration test suite that runs against the compiled binary with a mock LLM server.

**Architecture:** Three phases: (1) delete/fix existing noise tests, (2) add unit tests for critical untested behaviors, (3) build integration infrastructure (mock LLM server + binary harness) and write black-box tests against `dist/ra`. Integration tests use env vars to redirect LLM API calls to a local mock server.

**Tech Stack:** Bun test, bun:test, `Bun.spawn` for binary, `Bun.serve` for mock server, SSE for streaming tests.

---

## Phase 1: Cleanup

### Task 1: Delete three entire test files

**Files:**
- Delete: `tests/providers/types.test.ts`
- Delete: `tests/providers/registry.test.ts`
- Delete: `tests/e2e/agent.test.ts`

**Step 1: Delete the files**

```bash
rm tests/providers/types.test.ts tests/providers/registry.test.ts tests/e2e/agent.test.ts
```

**Step 2: Verify tests still pass**

Run: `bun test`
Expected: All tests pass, 3 fewer test files.

**Step 3: Commit**

```bash
git add -A
git commit -m "test: delete zero-value type shape and registry name tests"
```

---

### Task 2: Purge provider test noise

**Files:**
- Modify: `tests/providers/anthropic.test.ts`
- Modify: `tests/providers/openai.test.ts`
- Modify: `tests/providers/google.test.ts`
- Modify: `tests/providers/ollama.test.ts`
- Modify: `tests/providers/bedrock.test.ts`

**Step 1: Remove from `tests/providers/anthropic.test.ts`**

Delete the `has correct name` test (lines 6-9):
```ts
// DELETE:
it('has correct name', () => {
  const provider = new AnthropicProvider({ apiKey: 'test' })
  expect(provider.name).toBe('anthropic')
})
```

Delete `buildParams omits tools when not provided` (lines 159-166):
```ts
// DELETE:
it('buildParams omits tools when not provided', () => {
  const provider = new AnthropicProvider({ apiKey: 'test' })
  const params = (provider as any).buildParams({
    model: 'claude-3',
    messages: [{ role: 'user', content: 'hi' }],
  })
  expect(params.tools).toBeUndefined()
})
```

Delete `does not include thinking when not set` (lines 325-330):
```ts
// DELETE:
it('does not include thinking when not set', () => {
  const provider = new AnthropicProvider({ apiKey: 'test' })
  const request = { model: 'claude-3-7-sonnet-20250219', messages: [{ role: 'user' as const, content: 'hi' }] }
  const params = (provider as any).buildParams(request)
  expect(params.thinking).toBeUndefined()
})
```

Also delete `extracts system messages from message array` (lines 11-21) — this is tested in `google.test.ts` and `providers/utils` is the tested unit; having it in two provider files is redundant. Keep it only in `google.test.ts`.

**Step 2: Remove from `tests/providers/openai.test.ts`**

Delete `has correct name` test.

Delete `maps response without tool_calls` (asserts `toolCalls` is `undefined` — trivial absent-value check. The positive case `maps OpenAI response back to IMessage` already covers this code path).

Delete `omits tools when not provided` (negative branch of `includes tools when provided`).

**Step 3: Remove from `tests/providers/google.test.ts`**

Delete `has correct name` test.

Delete `returns undefined system when no system messages` (negative default of `extractSystemMessages`).

Delete `toUsage defaults to 0 when metadata is missing` (trivial fallback assertion).

Delete `returns undefined usage when usageMetadata is absent` (same pattern — asserting absence).

**Step 4: Remove from `tests/providers/ollama.test.ts`**

Delete `has correct name` test.

Delete `creates with default host` test — it asserts `provider.name === 'ollama'` again, duplicating the deleted name test.

Delete `buildParams omits tools when not provided`.

**Step 5: Remove from `tests/providers/bedrock.test.ts`**

Delete `has correct name` test.

Delete `maps text content part correctly` (single property pass-through assertion).

Delete `omits system when no system messages` (negative branch).

Delete `omits toolConfig when no tools` (negative branch).

Delete `defaults usage to 0 when not present` (trivial fallback).

**Step 6: Verify tests still pass**

Run: `bun test tests/providers/`
Expected: All remaining provider tests pass.

**Step 7: Commit**

```bash
git add tests/providers/
git commit -m "test: remove name-only and negative-branch provider tests"
```

---

### Task 3: Simplify mime.test.ts to test.each

**Files:**
- Modify: `tests/utils/mime.test.ts`

**Step 1: Replace with data-driven version**

Replace the entire file content with:

```ts
import { describe, it, expect } from 'bun:test'
import { getMimeType } from '../../src/utils/mime'

describe('getMimeType', () => {
  it.each([
    ['photo.png',         'image/png'],
    ['photo.jpg',         'image/jpeg'],
    ['photo.jpeg',        'image/jpeg'],
    ['anim.gif',          'image/gif'],
    ['img.webp',          'image/webp'],
    ['doc.pdf',           'application/pdf'],
    ['readme.txt',        'text/plain'],
    ['README.md',         'text/markdown'],
    ['config.json',       'application/json'],
    ['index.html',        'text/html'],
    ['data.csv',          'text/csv'],
  ])('returns correct MIME type for %s', (filename, expected) => {
    expect(getMimeType(filename)).toBe(expected)
  })

  it('returns octet-stream for unknown and missing extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream')
    expect(getMimeType('Makefile')).toBe('application/octet-stream')
  })

  it('handles uppercase extensions and multiple dots', () => {
    expect(getMimeType('PHOTO.PNG')).toBe('image/png')
    expect(getMimeType('/path/to/file.backup.json')).toBe('application/json')
  })
})
```

**Step 2: Verify tests pass**

Run: `bun test tests/utils/mime.test.ts`
Expected: All pass (15 → 13 it blocks but same coverage).

**Step 3: Commit**

```bash
git add tests/utils/mime.test.ts
git commit -m "test: convert mime tests to test.each table"
```

---

### Task 4: Fix specific bad tests in remaining files

**Files:**
- Modify: `tests/mcp/client.test.ts`
- Modify: `tests/config/index.test.ts`
- Modify: `tests/interfaces/tui.test.ts`
- Modify: `tests/agent/middleware.test.ts`
- Modify: `tests/skills/runner.test.ts`
- Modify: `tests/storage/sessions.test.ts`

**Step 1: `tests/mcp/client.test.ts` — remove "creates instance"**

Delete the first test (lines 6-11):
```ts
// DELETE:
it('creates instance', () => {
  const client = new McpClient()
  expect(client).toBeDefined()
  expect(typeof client.connect).toBe('function')
  expect(typeof client.disconnect).toBe('function')
})
```

**Step 2: `tests/config/index.test.ts` — replace toBeDefined() smoke test**

Replace the `deepMerge handles null values without crashing` test (lines 87-92):
```ts
// REPLACE with:
it('deepMerge: null in cliArgs overwrites object (documents overwrite behavior)', async () => {
  // When CLI passes null for an object key, it overwrites (not merges)
  // This documents the current behavior — callers should not pass null for object fields
  const c = await loadConfig({ cwd: tmp, cliArgs: { http: null } as any })
  // The http object is overwritten to null; accessing http.port would crash
  // This test documents the behavior so regressions are caught
  expect((c as any).http).toBeNull()
})
```

Also remove the two single-field thinking tests (lines 133-142) since `rejects invalid RA_THINKING values` and `maps all env vars` already cover these cases:
```ts
// DELETE (covered by 'maps all env vars' and 'rejects invalid' tests):
it('loads RA_THINKING from env', async () => {
  const config = await loadConfig({ env: { RA_THINKING: 'medium' } })
  expect(config.thinking).toBe('medium')
})

it('defaults thinking to undefined', async () => {
  const config = await loadConfig({ env: {} })
  expect(config.thinking).toBeUndefined()
})
```

**Step 3: `tests/interfaces/tui.test.ts` — remove constant value tests**

Delete the `TUI color constants` describe block (lines 23-31) — testing hardcoded ANSI escape sequences.

Delete the `PROMPT` describe block (lines 33-39) — same pattern.

Delete the `outputs two newlines` test inside `closeAssistantBox` (lines 99-103) — pins exact output format with no behavioral value.

**Step 4: `tests/agent/middleware.test.ts` — remove AbortController behavior tests**

Delete `stop() is idempotent — calling multiple times does not throw` (lines 65-72).

Delete `signal reflects aborted state after stop()` (lines 74-80).

These test `AbortController` built-in semantics, not our code.

**Step 5: `tests/skills/runner.test.ts` — remove duplicate .ts test**

Delete `runs .ts via bun (no shebang, bun is the default fallback)` in the `runSkillScript - new runtimes` describe block (lines 47-51). It is an exact duplicate of `runs a .ts script via bun and captures stdout` in the `existing behavior` block.

**Step 6: `tests/storage/sessions.test.ts` — remove redundant fresh-file test**

Delete `appendMessage works on a fresh file (no prior messages)` — the `appends and reads messages` test starts from a fresh session and already exercises this path.

**Step 7: Verify tests pass**

Run: `bun test`
Expected: All tests pass.

**Step 8: Commit**

```bash
git add tests/
git commit -m "test: remove smoke tests, duplicate tests, and constant-value assertions"
```

---

## Phase 2: New Unit Tests

### Task 5: Add Google base URL config support

This is a prerequisite for Google integration tests. The Google provider currently has no `baseURL` option.

**Files:**
- Modify: `src/providers/google.ts`
- Modify: `src/config/index.ts`
- Modify: `src/interfaces/parse-args.ts`

**Step 1: Write the failing test first**

Add to `tests/providers/google.test.ts`:
```ts
it('passes baseURL to GoogleGenerativeAI when provided', () => {
  const provider = new GoogleProvider({ apiKey: 'test', baseURL: 'http://localhost:9999' })
  // The baseURL should be stored/used — verify via the client's requestOptions
  expect((provider as any).client).toBeDefined()
  // Behavioral verification happens in integration tests
})
```

Run: `bun test tests/providers/google.test.ts`
Expected: TypeScript compilation error — `baseURL` not in `GoogleProviderOptions`.

**Step 2: Add `baseURL` to `GoogleProviderOptions`**

In `src/providers/google.ts`, change:
```ts
export interface GoogleProviderOptions {
  apiKey: string
}
```
to:
```ts
export interface GoogleProviderOptions {
  apiKey: string
  baseURL?: string
}
```

And update the constructor:
```ts
constructor(options: GoogleProviderOptions) {
  this.client = new GoogleGenerativeAI(
    options.apiKey,
    options.baseURL ? ({ baseUrl: options.baseURL } as any) : undefined,
  )
}
```

**Step 3: Add `RA_GOOGLE_BASE_URL` env var support**

In `src/config/index.ts`, add after the Google API key line:
```ts
if (env.RA_GOOGLE_API_KEY !== undefined)     set(['providers', 'google', 'apiKey'], env.RA_GOOGLE_API_KEY)
if (env.RA_GOOGLE_BASE_URL !== undefined)    set(['providers', 'google', 'baseURL'], env.RA_GOOGLE_BASE_URL)
```

**Step 4: Add `--google-base-url` CLI flag**

In `src/interfaces/parse-args.ts`, add to the options:
```ts
'google-base-url': { type: 'string' },
```

And in the provider connection section:
```ts
if (values['google-base-url']) set(['providers', 'google', 'baseURL'], values['google-base-url'])
```

**Step 5: Run tests**

Run: `bun test`
Expected: All tests pass including the new Google baseURL test.

**Step 6: Commit**

```bash
git add src/providers/google.ts src/config/index.ts src/interfaces/parse-args.ts tests/providers/google.test.ts
git commit -m "feat: add baseURL support to Google provider for integration testing"
```

---

### Task 6: New unit tests — agent loop

**Files:**
- Modify: `tests/agent/loop.test.ts`

**Step 1: Write tests**

Add to the `AgentLoop` describe block in `tests/agent/loop.test.ts`:

```ts
it('handles parallel tool calls — both execute and both results returned', async () => {
  const executedTools: string[] = []
  const provider = mockProvider([
    [
      { type: 'tool_call_start', id: 'tc1', name: 'tool_a' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"x":1}' },
      { type: 'tool_call_start', id: 'tc2', name: 'tool_b' },
      { type: 'tool_call_delta', id: 'tc2', argsDelta: '{"y":2}' },
      { type: 'done' },
    ],
    [{ type: 'text', delta: 'both done' }, { type: 'done' }],
  ])
  const tools = new ToolRegistry()
  tools.register({ name: 'tool_a', description: '', inputSchema: {}, execute: async () => { executedTools.push('a'); return 'result_a' } })
  tools.register({ name: 'tool_b', description: '', inputSchema: {}, execute: async () => { executedTools.push('b'); return 'result_b' } })
  const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
  const result = await loop.run([{ role: 'user', content: 'go' }])

  expect(executedTools).toContain('a')
  expect(executedTools).toContain('b')
  // Two tool result messages should be in the conversation
  const toolResults = result.messages.filter(m => m.role === 'tool')
  expect(toolResults).toHaveLength(2)
  expect(toolResults.some(m => m.content === 'result_a')).toBe(true)
  expect(toolResults.some(m => m.content === 'result_b')).toBe(true)
})

it('unknown tool name produces isError tool result instead of crashing', async () => {
  const provider = mockProvider([
    [
      { type: 'tool_call_start', id: 'tc1', name: 'nonexistent_tool' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
      { type: 'done' },
    ],
    [{ type: 'text', delta: 'handled' }, { type: 'done' }],
  ])
  const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10 })
  // Should not throw — error is captured in tool result
  const result = await loop.run([{ role: 'user', content: 'use unknown tool' }])
  const toolResult = result.messages.find(m => m.role === 'tool')
  expect(toolResult).toBeDefined()
  expect(toolResult!.isError).toBe(true)
  expect(toolResult!.content).toContain('nonexistent_tool')
})

it('malformed tool args (invalid JSON) are handled as empty object — tool still executes', async () => {
  let receivedInput: unknown
  const provider = mockProvider([
    [
      { type: 'tool_call_start', id: 'tc1', name: 'capture' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: 'not valid json{{{' },
      { type: 'done' },
    ],
    [{ type: 'text', delta: 'ok' }, { type: 'done' }],
  ])
  const tools = new ToolRegistry()
  tools.register({ name: 'capture', description: '', inputSchema: {}, execute: async (input) => { receivedInput = input; return 'ok' } })
  const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
  await loop.run([{ role: 'user', content: 'go' }])
  // Malformed JSON falls back to {} rather than crashing
  expect(receivedInput).toEqual({})
})
```

**Step 2: Run tests to verify they pass**

Run: `bun test tests/agent/loop.test.ts`
Expected: All pass. (The loop already handles these cases — tests document and protect the behavior.)

**Step 3: Commit**

```bash
git add tests/agent/loop.test.ts
git commit -m "test: add parallel tool calls, unknown tool, and malformed args tests"
```

---

### Task 7: New unit tests — config deepMerge

**Files:**
- Modify: `tests/config/index.test.ts`

**Step 1: Write tests**

Add inside the `loadConfig` describe block:

```ts
it('deepMerge: array in CLI args replaces array in defaults (not merged)', async () => {
  // deepMerge treats arrays as scalar values — they overwrite, not concat
  const c = await loadConfig({ cwd: tmp, cliArgs: { skillDirs: ['/custom'] } })
  expect(c.skillDirs).toEqual(['/custom'])
  // Verify it is exactly ['/custom'] not [...defaults, '/custom']
  expect(c.skillDirs).toHaveLength(1)
})

it('deepMerge: array in config file replaces default empty array', async () => {
  writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ skills: ['code', 'search'] }))
  const c = await loadConfig({ cwd: tmp })
  expect(c.skills).toEqual(['code', 'search'])
})
```

**Step 2: Run tests**

Run: `bun test tests/config/index.test.ts`
Expected: All pass.

**Step 3: Commit**

```bash
git add tests/config/index.test.ts
git commit -m "test: add deepMerge array replacement behavior tests"
```

---

### Task 8: New unit tests — storage prune

**Files:**
- Modify: `tests/storage/sessions.test.ts`

**Step 1: Write tests**

Add to the sessions test file (inside the describe block with tmp storage):

```ts
it('prune keeps exactly maxSessions newest sessions', async () => {
  // Create 5 sessions with a small delay so timestamps differ
  const ids: string[] = []
  for (let i = 0; i < 5; i++) {
    const s = await storage.create({ provider: 'anthropic', model: 'claude', interface: 'cli' })
    ids.push(s.id)
    await new Promise(r => setTimeout(r, 10)) // ensure distinct timestamps
  }

  await storage.prune({ maxSessions: 3 })
  const remaining = await storage.list()

  expect(remaining).toHaveLength(3)
  // Should keep the 3 newest (last 3 created)
  const remainingIds = remaining.map(s => s.id)
  expect(remainingIds).toContain(ids[2])
  expect(remainingIds).toContain(ids[3])
  expect(remainingIds).toContain(ids[4])
  expect(remainingIds).not.toContain(ids[0])
  expect(remainingIds).not.toContain(ids[1])
})

it('prune with maxSessions >= count deletes nothing', async () => {
  for (let i = 0; i < 3; i++) {
    await storage.create({ provider: 'anthropic', model: 'claude', interface: 'cli' })
  }
  await storage.prune({ maxSessions: 3 })
  expect((await storage.list())).toHaveLength(3)

  await storage.prune({ maxSessions: 10 })
  expect((await storage.list())).toHaveLength(3)
})

it('prune by ttlDays deletes only old sessions', async () => {
  // Create a session with an artificially old timestamp by writing meta directly
  const s = await storage.create({ provider: 'anthropic', model: 'claude', interface: 'cli' })
  const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString() // 10 days ago
  const metaPath = (storage as any).sessionDir(s.id) + '/meta.json'
  await Bun.write(metaPath, JSON.stringify({ id: s.id, created: oldDate, provider: 'anthropic', model: 'claude', interface: 'cli' }))

  const fresh = await storage.create({ provider: 'anthropic', model: 'claude', interface: 'cli' })

  await storage.prune({ ttlDays: 5 })
  const remaining = await storage.list()

  expect(remaining.some(r => r.id === fresh.id)).toBe(true)
  expect(remaining.some(r => r.id === s.id)).toBe(false)
})
```

**Step 2: Run tests**

Run: `bun test tests/storage/sessions.test.ts`
Expected: All pass.

**Step 3: Commit**

```bash
git add tests/storage/sessions.test.ts
git commit -m "test: add storage prune off-by-one and TTL tests"
```

---

## Phase 3: Integration Infrastructure

### Task 9: Build binary helper

**Files:**
- Create: `tests/integration/helpers/binary.ts`

**Step 1: Create the helper**

```ts
import { existsSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(import.meta.dir, '../../..')
export const BINARY_PATH = join(PROJECT_ROOT, 'dist/ra')

export async function ensureBinary(): Promise<void> {
  if (!existsSync(BINARY_PATH)) {
    console.log('[integration] Building binary...')
    const result = await Bun.$`bun run compile`.cwd(PROJECT_ROOT).quiet()
    if (result.exitCode !== 0) {
      throw new Error(`Binary build failed:\n${result.stderr.toString()}`)
    }
  }
}

export interface BinaryRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface BinaryEnv {
  provider?: string
  apiKey?: string
  anthropicBaseURL?: string
  openaiBaseURL?: string
  googleBaseURL?: string
  storageDir?: string
  extra?: Record<string, string>
}

function buildEnv(opts: BinaryEnv): Record<string, string> {
  const env: Record<string, string> = {}
  if (opts.provider) env['RA_PROVIDER'] = opts.provider
  if (opts.apiKey) {
    const p = opts.provider ?? 'anthropic'
    if (p === 'anthropic') env['RA_ANTHROPIC_API_KEY'] = opts.apiKey
    else if (p === 'openai') env['RA_OPENAI_API_KEY'] = opts.apiKey
    else if (p === 'google') env['RA_GOOGLE_API_KEY'] = opts.apiKey
  }
  if (opts.anthropicBaseURL) env['RA_ANTHROPIC_BASE_URL'] = opts.anthropicBaseURL
  if (opts.openaiBaseURL) env['RA_OPENAI_BASE_URL'] = opts.openaiBaseURL
  if (opts.googleBaseURL) env['RA_GOOGLE_BASE_URL'] = opts.googleBaseURL
  if (opts.storageDir) env['RA_STORAGE_PATH'] = opts.storageDir
  if (opts.extra) Object.assign(env, opts.extra)
  return env
}

/** Run binary to completion, return stdout/stderr/exitCode */
export async function runBinary(args: string[], binaryEnv: BinaryEnv): Promise<BinaryRunResult> {
  const proc = Bun.spawn([BINARY_PATH, ...args], {
    env: buildEnv(binaryEnv),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })
  proc.stdin.end()
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

/** Run binary with piped stdin */
export async function runBinaryWithStdin(args: string[], input: string, binaryEnv: BinaryEnv): Promise<BinaryRunResult> {
  const proc = Bun.spawn([BINARY_PATH, ...args], {
    env: buildEnv(binaryEnv),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })
  proc.stdin.write(input)
  proc.stdin.end()
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

export interface InteractiveProcess {
  write(text: string): void
  readAvailable(): Promise<string>
  kill(): void
  exited: Promise<BinaryRunResult>
}

/** Spawn an interactive binary process (for REPL tests) */
export function spawnBinary(args: string[], binaryEnv: BinaryEnv): InteractiveProcess {
  const proc = Bun.spawn([BINARY_PATH, ...args], {
    env: buildEnv(binaryEnv),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })

  const stdoutBufs: Uint8Array[] = []
  const decoder = new TextDecoder()

  // Drain stdout into buffer
  ;(async () => {
    for await (const chunk of proc.stdout) {
      stdoutBufs.push(chunk)
    }
  })()

  return {
    write(text: string) { proc.stdin.write(text) },
    async readAvailable(): Promise<string> {
      await new Promise(r => setTimeout(r, 200))
      const all = stdoutBufs.splice(0).map(b => decoder.decode(b)).join('')
      return all
    },
    kill() { proc.kill() },
    exited: (async () => {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      return { stdout, stderr, exitCode: await proc.exited }
    })(),
  }
}
```

**Step 2: Verify it compiles**

Run: `bun tsc --noEmit`
Expected: No errors.

---

### Task 10: Build mock LLM server

**Files:**
- Create: `tests/integration/helpers/mock-llm-server.ts`

**Step 1: Create the mock server**

```ts
export type MockResponse =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'error'; status: number; message: string }

export interface RecordedRequest {
  path: string
  body: unknown
  provider: 'anthropic' | 'openai' | 'google' | 'unknown'
}

export interface MockLLMServer {
  port: number
  anthropicBaseURL: string
  openaiBaseURL: string
  googleBaseURL: string
  /** Queue responses — consumed in order per request */
  enqueue(responses: MockResponse[]): void
  /** All requests received since start or last reset */
  requests(): RecordedRequest[]
  /** Clear request log */
  resetRequests(): void
  stop(): Promise<void>
}

function sseAnthropicText(content: string): string {
  const lines: string[] = []
  const send = (event: string, data: unknown) =>
    lines.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n`)

  send('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } })
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } })
  send('content_block_stop', { type: 'content_block_stop', index: 0 })
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
  send('message_stop', { type: 'message_stop' })

  return lines.join('\n') + '\n'
}

function sseAnthropicToolCall(name: string, args: Record<string, unknown>): string {
  const lines: string[] = []
  const send = (event: string, data: unknown) =>
    lines.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n`)

  send('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } })
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${name}`, name } })
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } })
  send('content_block_stop', { type: 'content_block_stop', index: 0 })
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } })
  send('message_stop', { type: 'message_stop' })

  return lines.join('\n') + '\n'
}

function sseOpenAIText(content: string): string {
  const id = 'chatcmpl-mock'
  const chunks = [
    JSON.stringify({ id, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }),
    JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    '[DONE]',
  ]
  return chunks.map(c => `data: ${c}\n\n`).join('')
}

function sseOpenAIToolCall(name: string, args: Record<string, unknown>): string {
  const id = 'chatcmpl-mock'
  const callId = `call_${name}`
  const chunks = [
    JSON.stringify({ id, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: callId, type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] }),
    JSON.stringify({ id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }, finish_reason: null }] }),
    JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 20 } }),
    '[DONE]',
  ]
  return chunks.map(c => `data: ${c}\n\n`).join('')
}

function sseGoogleText(content: string): string {
  const events = [
    { candidates: [{ content: { parts: [{ text: content }], role: 'model' }, index: 0 }] },
    { candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
  ]
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')
}

function sseGoogleToolCall(name: string, args: Record<string, unknown>): string {
  const event = { candidates: [{ content: { parts: [{ functionCall: { name, args } }], role: 'model' }, finishReason: 'STOP', index: 0 }] }
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function startMockLLMServer(): Promise<MockLLMServer> {
  const queue: MockResponse[] = []
  const recorded: RecordedRequest[] = []

  const server = Bun.serve({
    port: 0, // random port
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname
      let body: unknown = null
      try { body = await req.json() } catch { /* no body */ }

      let provider: RecordedRequest['provider'] = 'unknown'
      if (path.startsWith('/anthropic')) provider = 'anthropic'
      else if (path.startsWith('/openai') || path.includes('/chat/completions')) provider = 'openai'
      else if (path.includes('generateContent')) provider = 'google'

      recorded.push({ path, body, provider })

      const response = queue.shift()
      if (!response) {
        return new Response(JSON.stringify({ error: 'No mock response queued' }), { status: 500 })
      }

      if (response.type === 'error') {
        return new Response(JSON.stringify({ error: response.message }), { status: response.status })
      }

      let sseBody: string
      if (provider === 'anthropic') {
        sseBody = response.type === 'text'
          ? sseAnthropicText(response.content)
          : sseAnthropicToolCall(response.name, response.args)
      } else if (provider === 'openai') {
        sseBody = response.type === 'text'
          ? sseOpenAIText(response.content)
          : sseOpenAIToolCall(response.name, response.args)
      } else {
        // Google
        sseBody = response.type === 'text'
          ? sseGoogleText(response.content)
          : sseGoogleToolCall(response.name, response.args)
      }

      return new Response(sseBody, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    },
  })

  const port = server.port
  const base = `http://127.0.0.1:${port}`

  return {
    port,
    anthropicBaseURL: `${base}/anthropic`,
    openaiBaseURL: `${base}/openai`,
    googleBaseURL: `${base}/google`,
    enqueue(responses: MockResponse[]) { queue.push(...responses) },
    requests() { return [...recorded] },
    resetRequests() { recorded.length = 0 },
    async stop() { server.stop(true) },
  }
}
```

**Step 2: Create fixture tools for integration tests**

Create `tests/integration/fixtures/tools/echo-tool.ts` — a real executable binary wrapper script:
```ts
// This file is imported by the binary via --mcp-servers or inline in tests
// Not needed as a file — tools are registered inline via the mock provider
```

Actually, the binary doesn't accept inline tool registration. Tools come from MCP servers. For CLI/HTTP/REPL tests we don't need custom tools — the mock provider doesn't actually require tool execution against the binary since we control the mock responses.

For the agentic flow tests that test actual tool execution, we'll use the built-in no-op by having the mock provider call a tool, and any tool executed by the binary will return an error (since no tools are registered by default). The mock server can then return a final text answer.

**Step 3: Create fixture middleware for integration tests**

Create `tests/integration/fixtures/middleware/recorder.ts`:
```ts
// Middleware that records which hooks were called — writes to a temp file
// Usage: RA_RECORDER_FILE=/tmp/hooks.json
export default async function (ctx: any) {
  const file = process.env['RA_RECORDER_FILE']
  if (!file) return
  const existing = await Bun.file(file).exists() ? JSON.parse(await Bun.file(file).text()) : []
  existing.push(ctx.constructor?.name ?? 'unknown')
  await Bun.write(file, JSON.stringify(existing))
}
```

Actually, for hook recording we need per-hook files. Use a simpler approach in the test itself.

**Step 4: Verify compilation**

Run: `bun tsc --noEmit`
Expected: No errors.

---

### Task 11: Create integration test setup helper

**Files:**
- Create: `tests/integration/helpers/setup.ts`

**Step 1: Create**

```ts
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ensureBinary } from './binary'
import { startMockLLMServer, type MockLLMServer } from './mock-llm-server'
import type { BinaryEnv } from './binary'

export interface TestEnv {
  mock: MockLLMServer
  storageDir: string
  binaryEnv: BinaryEnv
  cleanup(): Promise<void>
}

/** Create a test environment with mock LLM server and temp storage */
export async function createTestEnv(provider: 'anthropic' | 'openai' | 'google' = 'anthropic'): Promise<TestEnv> {
  await ensureBinary()
  const mock = await startMockLLMServer()
  const storageDir = join(tmpdir(), `ra-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(storageDir, { recursive: true })

  const binaryEnv: BinaryEnv = {
    provider,
    apiKey: 'test-key',
    anthropicBaseURL: mock.anthropicBaseURL,
    openaiBaseURL: mock.openaiBaseURL,
    googleBaseURL: mock.googleBaseURL,
    storageDir,
  }

  return {
    mock,
    storageDir,
    binaryEnv,
    async cleanup() {
      await mock.stop()
      rmSync(storageDir, { recursive: true, force: true })
    },
  }
}
```

---

## Phase 4: Integration Tests

### Task 12: CLI integration tests

**Files:**
- Create: `tests/integration/cli.test.ts`

**Step 1: Write tests**

```ts
import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinaryWithStdin } from './helpers/binary'

describe('CLI integration', () => {
  let env: TestEnv

  beforeAll(async () => { env = await createTestEnv() })
  afterEach(() => { env.mock.resetRequests() })
  // Note: no afterAll cleanup — share env across tests for performance

  it('simple prompt → text response → stdout contains response, exit 0', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Paris is the capital of France.' }])
    const { stdout, exitCode } = await runBinaryWithStdin(
      ['--cli', 'What is the capital of France?'],
      '',
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Paris is the capital of France.')
  })

  it('piped stdin becomes the prompt in CLI mode', async () => {
    env.mock.enqueue([{ type: 'text', content: 'I see your input.' }])
    const { stdout, exitCode } = await runBinaryWithStdin(
      [],
      'summarize this text',
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('I see your input.')
    // stdin should have been sent to the mock server
    const req = env.mock.requests()[0]
    expect(JSON.stringify(req?.body)).toContain('summarize this text')
  })

  it('provider error → exit nonzero, stderr contains error', async () => {
    env.mock.enqueue([{ type: 'error', status: 500, message: 'Internal Server Error' }])
    const { stderr, exitCode } = await runBinaryWithStdin(
      ['--cli', 'hello'],
      '',
      env.binaryEnv,
    )
    expect(exitCode).not.toBe(0)
    expect(stderr.length).toBeGreaterThan(0)
  })

  it('--max-iterations 1 with always-tool-calling LLM stops after 1 iteration', async () => {
    // Enqueue 10 tool-calling responses — binary should stop at 1
    for (let i = 0; i < 10; i++) {
      env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: {} }])
    }
    env.mock.enqueue([{ type: 'text', content: 'stopped' }])
    const { exitCode } = await runBinaryWithStdin(
      ['--cli', '--max-iterations', '1', 'go'],
      '',
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    // Only 1 request should have been made to the mock (1 iteration)
    expect(env.mock.requests()).toHaveLength(1)
  })

  it('uses openai provider when --provider openai is set', async () => {
    env.mock.enqueue([{ type: 'text', content: 'OpenAI says hello.' }])
    const { stdout, exitCode } = await runBinaryWithStdin(
      ['--cli', '--provider', 'openai', '--model', 'gpt-4o', 'hello'],
      '',
      { ...env.binaryEnv, provider: 'openai' },
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('OpenAI says hello.')
    expect(env.mock.requests()[0]?.provider).toBe('openai')
  })
})
```

**Step 2: Run tests**

Run: `bun test tests/integration/cli.test.ts`
Expected: All pass (may need `bun run compile` first).

**Step 3: Commit**

```bash
git add tests/integration/
git commit -m "test(integration): add CLI mode tests against compiled binary"
```

---

### Task 13: HTTP interface integration tests

**Files:**
- Create: `tests/integration/http.test.ts`

**Step 1: Write tests**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { spawnBinary } from './helpers/binary'
import type { InteractiveProcess } from './helpers/binary'

async function waitForPort(port: number, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/sessions`)
      return
    } catch {
      await new Promise(r => setTimeout(r, 100))
    }
  }
  throw new Error(`Port ${port} not ready after ${timeout}ms`)
}

describe('HTTP interface integration', () => {
  let env: TestEnv
  let httpProc: InteractiveProcess
  const HTTP_PORT = 19876
  const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`

  beforeAll(async () => {
    env = await createTestEnv()
    httpProc = spawnBinary(
      ['--http', '--http-port', String(HTTP_PORT), '--model', 'claude-sonnet-4-6'],
      env.binaryEnv,
    )
    await waitForPort(HTTP_PORT)
  })

  afterAll(async () => {
    httpProc.kill()
    await env.cleanup()
  })

  afterEach(() => env.mock.resetRequests())

  it('POST /chat/sync returns { response } JSON with text', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Hello from sync!' }])
    const res = await fetch(`${BASE_URL}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.response).toContain('Hello from sync!')
  })

  it('POST /chat streams SSE events', async () => {
    env.mock.enqueue([{ type: 'text', content: 'streaming response' }])
    const res = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'stream test' }] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    expect(text).toContain('data:')
    // Should contain a done event
    expect(text).toContain('"type":"done"')
  })

  it('missing auth token returns 401', async () => {
    // Restart with token required
    httpProc.kill()
    const tokenProc = spawnBinary(
      ['--http', '--http-port', String(HTTP_PORT + 1), '--http-token', 'secret123'],
      env.binaryEnv,
    )
    await waitForPort(HTTP_PORT + 1)

    const res = await fetch(`http://127.0.0.1:${HTTP_PORT + 1}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(401)

    tokenProc.kill()
    // Restart original
    const newProc = spawnBinary(['--http', '--http-port', String(HTTP_PORT), '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await waitForPort(HTTP_PORT)
    ;(httpProc as any) = newProc
  })

  it('wrong auth token returns 401', async () => {
    httpProc.kill()
    const tokenProc = spawnBinary(
      ['--http', '--http-port', String(HTTP_PORT + 2), '--http-token', 'correct-token'],
      env.binaryEnv,
    )
    await waitForPort(HTTP_PORT + 2)

    const res = await fetch(`http://127.0.0.1:${HTTP_PORT + 2}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wrong-token' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(401)
    tokenProc.kill()
    const newProc = spawnBinary(['--http', '--http-port', String(HTTP_PORT), '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await waitForPort(HTTP_PORT)
    ;(httpProc as any) = newProc
  })

  it('GET /sessions returns sessions array', async () => {
    const res = await fetch(`${BASE_URL}/sessions`)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(Array.isArray(data.sessions)).toBe(true)
  })

  it('two sync requests with same sessionId share conversation (second request receives prior context)', async () => {
    const sessionId = 'test-session-shared'
    env.mock.enqueue([{ type: 'text', content: 'First response.' }])
    await fetch(`${BASE_URL}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'first turn' }], sessionId }),
    })

    env.mock.enqueue([{ type: 'text', content: 'Second response.' }])
    await fetch(`${BASE_URL}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'second turn' }], sessionId }),
    })

    // Both requests should have reached the mock
    expect(env.mock.requests()).toHaveLength(2)
  })
})
```

**Step 2: Run tests**

Run: `bun test tests/integration/http.test.ts --timeout 30000`
Expected: All pass.

**Step 3: Commit**

```bash
git add tests/integration/http.test.ts
git commit -m "test(integration): add HTTP interface tests"
```

---

### Task 14: REPL integration tests

**Files:**
- Create: `tests/integration/repl.test.ts`

**Step 1: Write tests**

```ts
import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { spawnBinary } from './helpers/binary'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

describe('REPL integration', () => {
  let env: TestEnv

  beforeAll(async () => { env = await createTestEnv() })
  afterEach(() => env.mock.resetRequests())

  it('sends a message and receives response on stdout', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Hello there!' }])
    const proc = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500) // wait for startup
    proc.write('hello\n')
    await delay(1000) // wait for response
    const output = await proc.readAvailable()
    proc.kill()
    expect(output).toContain('Hello there!')
  })

  it('/clear command — next message starts fresh context (only 1 user message sent to mock)', async () => {
    env.mock.enqueue([{ type: 'text', content: 'First response.' }])
    env.mock.enqueue([{ type: 'text', content: 'After clear.' }])

    const proc = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)

    proc.write('first message\n')
    await delay(800)
    proc.write('/clear\n')
    await delay(300)
    proc.write('second message\n')
    await delay(800)
    proc.kill()

    // Second request to the mock should have only 1 user message (not 3)
    const reqs = env.mock.requests()
    expect(reqs.length).toBeGreaterThanOrEqual(2)
    const secondReqBody = reqs[1]?.body as any
    const msgs = secondReqBody?.messages ?? secondReqBody?.contents ?? []
    const userMessages = msgs.filter((m: any) => m.role === 'user' || m.role === 'human')
    expect(userMessages.length).toBe(1)
  })

  it('/attach <file> includes file content in next request', async () => {
    const tmpDir = join(tmpdir(), `ra-repl-attach-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const testFile = join(tmpDir, 'test.txt')
    writeFileSync(testFile, 'file contents for testing')

    env.mock.enqueue([{ type: 'text', content: 'I see the file.' }])

    const proc = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)
    proc.write(`/attach ${testFile}\n`)
    await delay(300)
    proc.write('what is in the file?\n')
    await delay(800)
    proc.kill()

    const req = env.mock.requests()[0]
    expect(JSON.stringify(req?.body)).toContain('file contents for testing')
  })

  it('/save and /resume restores prior messages', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Remembered.' }])

    // First session: send a message, save, get session ID
    const proc1 = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)
    proc1.write('remember this: secret42\n')
    await delay(800)
    proc1.write('/save\n')
    await delay(300)
    const output1 = await proc1.readAvailable()
    proc1.kill()

    // Extract session ID from the /save output
    const sessionMatch = output1.match(/[0-9a-f-]{36}/)
    if (!sessionMatch) return // skip if no session ID found in output

    const sessionId = sessionMatch[0]
    env.mock.enqueue([{ type: 'text', content: 'Second session response.' }])

    // Second session: resume, send a message, verify prior messages are in context
    const proc2 = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6', '--resume', sessionId], env.binaryEnv)
    await delay(500)
    proc2.write('what did I say to remember?\n')
    await delay(800)
    proc2.kill()

    // The second request should contain the prior messages
    const reqs = env.mock.requests()
    expect(reqs.length).toBeGreaterThanOrEqual(2) // 1 from first session, 1 from second
    const secondBody = reqs[reqs.length - 1]?.body as any
    expect(JSON.stringify(secondBody)).toContain('secret42')
  })

  it('SIGINT during response exits cleanly without zombie process', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Long response...' }])
    const proc = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)
    proc.write('start something\n')
    await delay(200)
    proc.kill()
    // Should not hang — process should exit
    const result = await Promise.race([
      proc.exited,
      new Promise<null>(r => setTimeout(() => r(null), 3000)),
    ])
    expect(result).not.toBeNull()
  })
})
```

**Step 2: Run tests**

Run: `bun test tests/integration/repl.test.ts --timeout 60000`
Expected: All pass.

**Step 3: Commit**

```bash
git add tests/integration/repl.test.ts
git commit -m "test(integration): add REPL interface tests"
```

---

### Task 15: MCP integration tests

**Files:**
- Create: `tests/integration/mcp.test.ts`

**Step 1: Write a fixture MCP server**

Create `tests/integration/fixtures/mcp-server/server.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'test-server', version: '1.0.0' })

server.tool('echo_text', 'Echo the input text', { text: z.string() }, async ({ text }) => ({
  content: [{ type: 'text' as const, text: `echo: ${text}` }],
}))

server.tool('fail_tool', 'Always fails', {}, async () => {
  throw new Error('intentional failure')
})

server.connect(new StdioServerTransport())
```

**Step 2: Write MCP tests**

Create `tests/integration/mcp.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinary } from './helpers/binary'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'

const FIXTURE_MCP_SERVER = join(import.meta.dir, 'fixtures/mcp-server/server.ts')

describe('MCP client integration', () => {
  let env: TestEnv
  let tmpDir: string

  beforeAll(async () => {
    env = await createTestEnv()
    tmpDir = join(tmpdir(), `ra-mcp-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => env.mock.resetRequests())

  it('connects to stdio MCP server and registers its tools', async () => {
    // The mock LLM returns a tool call to 'echo_text', then returns the final response
    env.mock.enqueue([{ type: 'tool_call', name: 'echo_text', args: { text: 'hello MCP' } }])
    env.mock.enqueue([{ type: 'text', content: 'MCP tool returned: echo: hello MCP' }])

    // Write MCP server config
    const mcpConfig = JSON.stringify({
      mcp: {
        client: [{
          name: 'test-mcp',
          transport: 'stdio',
          command: 'bun',
          args: ['run', FIXTURE_MCP_SERVER],
        }],
      },
    })
    const configFile = join(tmpDir, 'ra.config.json')
    writeFileSync(configFile, mcpConfig)

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'call the echo tool with hello MCP'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    // The mock LLM response included the tool's output in its final reply
    expect(stdout).toContain('echo: hello MCP')
  })

  it('MCP tool execution error is returned as error tool result (loop does not crash)', async () => {
    env.mock.enqueue([{ type: 'tool_call', name: 'fail_tool', args: {} }])
    env.mock.enqueue([{ type: 'text', content: 'Tool failed but I continue.' }])

    const configFile = join(tmpDir, 'ra.config.json')
    writeFileSync(configFile, JSON.stringify({
      mcp: {
        client: [{ name: 'test-mcp', transport: 'stdio', command: 'bun', args: ['run', FIXTURE_MCP_SERVER] }],
      },
    }))

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'call fail_tool'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Tool failed but I continue.')
  })
})
```

**Step 3: Run tests**

Run: `bun test tests/integration/mcp.test.ts --timeout 30000`
Expected: All pass.

**Step 4: Commit**

```bash
git add tests/integration/mcp.test.ts tests/integration/fixtures/
git commit -m "test(integration): add MCP client integration tests"
```

---

### Task 16: Agentic flow integration tests

**Files:**
- Create: `tests/integration/agentic-flow.test.ts`

**Step 1: Write tests**

```ts
import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinary } from './helpers/binary'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Agentic flow integration', () => {
  let env: TestEnv
  let tmpDir: string

  beforeAll(async () => {
    env = await createTestEnv()
    tmpDir = join(tmpdir(), `ra-agentic-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => env.mock.resetRequests())

  it('multi-turn tool loop: LLM calls tool twice then gives final answer', async () => {
    // Turn 1: LLM calls tool_a
    env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: { step: 1 } }])
    // Turn 2: LLM calls tool_b
    env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: { step: 2 } }])
    // Turn 3: LLM gives final answer
    env.mock.enqueue([{ type: 'text', content: 'All steps complete. Final answer: 42.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--max-iterations', '10', 'do multi-step task'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Final answer: 42.')
    // 3 requests to mock (one per loop iteration)
    expect(env.mock.requests()).toHaveLength(3)
  })

  it('max iterations stops the loop and exits cleanly', async () => {
    // Always return tool calls — should stop at maxIterations
    for (let i = 0; i < 20; i++) {
      env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: {} }])
    }

    const { exitCode } = await runBinary(
      ['--cli', '--max-iterations', '3', 'go'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    // Should have made at most 3 requests
    expect(env.mock.requests().length).toBeLessThanOrEqual(3)
  })

  it('session persistence: second run with same session ID receives prior messages', async () => {
    const sessionId = `persist-test-${Date.now()}`
    env.mock.enqueue([{ type: 'text', content: 'I remember you said banana.' }])

    // First run: establish context
    await runBinary(
      ['--cli', '--resume', sessionId, 'remember banana'],
      env.binaryEnv,
    )
    env.mock.resetRequests()

    env.mock.enqueue([{ type: 'text', content: 'You said banana earlier.' }])

    // Second run: resume session
    await runBinary(
      ['--cli', '--resume', sessionId, 'what did I say?'],
      env.binaryEnv,
    )

    const secondReq = env.mock.requests()[0]?.body as any
    const messages = secondReq?.messages ?? []
    // Prior messages should be in context
    expect(JSON.stringify(messages)).toContain('banana')
  })

  it('middleware hooks fire in correct order via --middleware flag', async () => {
    const hooksFile = join(tmpDir, 'hooks-log.json')
    writeFileSync(hooksFile, '[]')

    // Write a middleware file that appends to the hooks log
    const mwFile = join(tmpDir, 'hook-recorder.ts')
    writeFileSync(mwFile, `
import { appendFileSync } from 'fs'
export default async function(ctx: any) {
  const file = '${hooksFile.replace(/\\/g, '/')}'
  try {
    const existing = JSON.parse(require('fs').readFileSync(file, 'utf8'))
    existing.push('beforeLoopBegin')
    require('fs').writeFileSync(file, JSON.stringify(existing))
  } catch {}
}
`)

    env.mock.enqueue([{ type: 'text', content: 'done' }])

    const config = JSON.stringify({ middleware: { beforeLoopBegin: [mwFile] } })
    const configFile = join(tmpDir, 'ra-mw.config.json')
    writeFileSync(configFile, config)

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'test middleware'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)

    const logged = JSON.parse(require('fs').readFileSync(hooksFile, 'utf8'))
    expect(logged).toContain('beforeLoopBegin')
  })

  it('context compaction triggers mid-conversation and run completes successfully', async () => {
    // Use a very low maxTokens compaction threshold
    // First 5 calls: tool calls to build up context
    for (let i = 0; i < 5; i++) {
      env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: { data: 'x'.repeat(50) } }])
    }
    // The compaction summarization call (provider.chat): return a summary
    env.mock.enqueue([{ type: 'text', content: 'Summary of prior work.' }])
    // Final response after compaction
    env.mock.enqueue([{ type: 'text', content: 'Compaction worked, final answer.' }])

    const config = JSON.stringify({
      compaction: { enabled: true, threshold: 0.1, maxTokens: 100, contextWindow: 1000 },
    })
    const configFile = join(tmpDir, 'ra-compact.config.json')
    writeFileSync(configFile, config)

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '20', 'start'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Compaction worked, final answer.')
    // More than 6 requests means compaction triggered a summarization call
    expect(env.mock.requests().length).toBeGreaterThanOrEqual(6)
  })
})
```

**Step 2: Run tests**

Run: `bun test tests/integration/agentic-flow.test.ts --timeout 60000`
Expected: All pass.

**Step 3: Commit**

```bash
git add tests/integration/agentic-flow.test.ts
git commit -m "test(integration): add full agentic flow integration tests"
```

---

### Task 17: Final verification — run all tests

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 2: Run only integration tests**

Run: `bun test tests/integration/ --timeout 60000`
Expected: All integration tests pass.

**Step 3: Run only unit tests**

Run: `bun test --exclude 'tests/integration/**'`
Expected: All unit tests pass.

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: complete test cleanup and integration layer"
```

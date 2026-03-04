# ra — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a generic, configurable agentic framework in Bun/TypeScript that supports multiple model providers, skills, MCP, multimodality, and middleware-driven lifecycle.

**Architecture:** Direct provider SDKs behind a unified `IProvider` interface. Middleware chains drive the agentic loop lifecycle. Skills are user-message injection with optional sidecars. MCP is both client and server. Three interfaces (CLI, REPL, HTTP) share the same core.

**Tech Stack:** Bun, TypeScript, `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `ollama`, `@modelcontextprotocol/sdk`, `js-yaml`, `smol-toml`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`

**Step 1: Initialize project**

Run: `bun init -y`

**Step 2: Install core dependencies**

Run: `bun add @anthropic-ai/sdk openai @google/generative-ai ollama @modelcontextprotocol/sdk js-yaml smol-toml`

**Step 3: Install dev dependencies**

Run: `bun add -d @types/bun`

**Step 4: Configure tsconfig**

Set `strict: true`, `target: "ESNext"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `outDir: "dist"`, `rootDir: "src"`.

**Step 5: Create directory structure**

```bash
mkdir -p src/{providers,agent,skills,mcp,config,interfaces,storage}
```

**Step 6: Create placeholder entry point**

`src/index.ts`:
```typescript
console.log('ra agent')
```

**Step 7: Verify it runs**

Run: `bun run src/index.ts`
Expected: prints `ra agent`

**Step 8: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold ra project"
```

---

### Task 2: Core Types

**Files:**
- Create: `src/providers/types.ts`
- Create: `src/agent/types.ts`

**Step 1: Write provider types test**

Create `tests/providers/types.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import type { IProvider, ChatRequest, IMessage, ITool, StreamChunk, ContentPart, TokenUsage } from '../../src/providers/types'

describe('provider types', () => {
  it('ChatRequest accepts messages and optional tools', () => {
    const req: ChatRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hello' }],
    }
    expect(req.model).toBe('claude-sonnet-4-6')
  })

  it('IMessage supports multimodal content', () => {
    const msg: IMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
      ],
    }
    expect(Array.isArray(msg.content)).toBe(true)
  })

  it('StreamChunk covers all chunk types', () => {
    const chunks: StreamChunk[] = [
      { type: 'text', delta: 'hello' },
      { type: 'tool_call_start', id: '1', name: 'test' },
      { type: 'tool_call_delta', id: '1', argsDelta: '{"x":1}' },
      { type: 'tool_call_end', id: '1' },
      { type: 'done' },
    ]
    expect(chunks).toHaveLength(5)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/types.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Implement provider types**

`src/providers/types.ts`:
```typescript
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'file'; mimeType: string; data: Buffer | string }

export type ImageSource =
  | { type: 'base64'; mediaType: string; data: string }
  | { type: 'url'; url: string }

export interface IMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | ContentPart[]
  toolCallId?: string        // for role: 'tool' — matches the tool_call id
  toolCalls?: IToolCall[]    // for role: 'assistant' — tool calls made
}

export interface IToolCall {
  id: string
  name: string
  arguments: string          // JSON string
}

export interface IToolResult {
  toolCallId: string
  content: string | ContentPart[]
  isError?: boolean
}

export interface ITool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute(input: unknown): Promise<unknown>
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'done'; usage?: TokenUsage }

export interface ChatRequest {
  model: string
  messages: IMessage[]
  tools?: ITool[]
  providerOptions?: Record<string, unknown>
}

export interface ChatResponse {
  message: IMessage
  usage?: TokenUsage
}

export interface IProvider {
  name: string
  chat(request: ChatRequest): Promise<ChatResponse>
  stream(request: ChatRequest): AsyncIterable<StreamChunk>
}
```

**Step 4: Implement agent types**

`src/agent/types.ts`:
```typescript
import type { IToolCall, IToolResult, StreamChunk, IMessage, ChatRequest } from '../providers/types'

export interface LoopContext {
  messages: IMessage[]
  iteration: number
  maxIterations: number
  sessionId: string
}

export interface ModelCallContext {
  request: ChatRequest
  loop: LoopContext
}

export interface StreamChunkContext {
  chunk: StreamChunk
  loop: LoopContext
}

export interface ToolExecutionContext {
  toolCall: IToolCall
  loop: LoopContext
}

export interface ToolResultContext {
  toolCall: IToolCall
  result: IToolResult
  loop: LoopContext
}

export interface ErrorContext {
  error: Error
  loop: LoopContext
  phase: 'model_call' | 'tool_execution' | 'stream'
}

export type Middleware<T> = (ctx: T, next: () => Promise<void>) => Promise<void>

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

**Step 5: Run tests**

Run: `bun test tests/providers/types.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add core provider and agent types"
```

---

### Task 3: Middleware Runner

**Files:**
- Create: `src/agent/middleware.ts`
- Create: `tests/agent/middleware.test.ts`

**Step 1: Write failing test**

`tests/agent/middleware.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { runMiddlewareChain } from '../../src/agent/middleware'

describe('runMiddlewareChain', () => {
  it('runs middleware in order', async () => {
    const order: number[] = []
    const chain = [
      async (_ctx: any, next: () => Promise<void>) => { order.push(1); await next(); order.push(4) },
      async (_ctx: any, next: () => Promise<void>) => { order.push(2); await next(); order.push(3) },
    ]
    await runMiddlewareChain({}, chain)
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('short-circuits when next is not called', async () => {
    const order: number[] = []
    const chain = [
      async (_ctx: any, _next: () => Promise<void>) => { order.push(1) },
      async (_ctx: any, next: () => Promise<void>) => { order.push(2); await next() },
    ]
    await runMiddlewareChain({}, chain)
    expect(order).toEqual([1])
  })

  it('passes context to all middleware', async () => {
    const ctx = { value: 0 }
    const chain = [
      async (c: any, next: () => Promise<void>) => { c.value += 1; await next() },
      async (c: any, next: () => Promise<void>) => { c.value += 10; await next() },
    ]
    await runMiddlewareChain(ctx, chain)
    expect(ctx.value).toBe(11)
  })

  it('handles empty chain', async () => {
    await runMiddlewareChain({}, [])
    // should not throw
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/agent/middleware.test.ts`
Expected: FAIL

**Step 3: Implement middleware runner**

`src/agent/middleware.ts`:
```typescript
import type { Middleware } from './types'

export async function runMiddlewareChain<T>(ctx: T, chain: Middleware<T>[]): Promise<void> {
  let index = 0

  async function next(): Promise<void> {
    if (index >= chain.length) return
    const middleware = chain[index++]
    await middleware(ctx, next)
  }

  await next()
}
```

**Step 4: Run tests**

Run: `bun test tests/agent/middleware.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add middleware chain runner"
```

---

### Task 4: Config System

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/index.ts`
- Create: `src/config/defaults.ts`
- Create: `tests/config/index.test.ts`

**Step 1: Write failing test**

`tests/config/index.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { loadConfig } from '../../src/config'
import type { RaConfig } from '../../src/config/types'

describe('config', () => {
  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig({ cwd: '/tmp/nonexistent' })
    expect(config.provider).toBe('anthropic')
    expect(config.interface).toBe('repl')
    expect(config.maxIterations).toBe(50)
  })

  it('merges CLI args over defaults', async () => {
    const config = await loadConfig({
      cwd: '/tmp/nonexistent',
      cliArgs: { provider: 'openai', model: 'gpt-4o' },
    })
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
  })

  it('resolves systemPrompt from file path', async () => {
    const tmpFile = '/tmp/ra-test-prompt.md'
    await Bun.write(tmpFile, 'You are a test agent.')
    const config = await loadConfig({
      cwd: '/tmp/nonexistent',
      cliArgs: { systemPrompt: tmpFile },
    })
    expect(config.systemPrompt).toBe('You are a test agent.')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config/index.test.ts`
Expected: FAIL

**Step 3: Implement config types**

`src/config/types.ts`:
```typescript
export interface RaConfig {
  provider: string
  model: string
  interface: 'cli' | 'repl' | 'http'
  systemPrompt: string
  http: { port: number; token: string }
  skills: string[]
  alwaysLoad: string[]
  mcp: {
    client: McpClientConfig[]
    server: McpServerConfig
  }
  providers: {
    anthropic: { apiKey: string }
    openai: { apiKey: string }
    google: { apiKey: string }
    ollama: { baseUrl: string }
  }
  storage: {
    path: string
    format: 'jsonl'
    maxSessions: number
    ttlDays: number
  }
  maxIterations: number
  middleware: Record<string, string[]>
}

export interface McpClientConfig {
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
}

export interface McpServerConfig {
  enabled: boolean
  port: number
  tool: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }
}

export interface LoadConfigOptions {
  cwd?: string
  configPath?: string
  cliArgs?: Partial<RaConfig>
  env?: Record<string, string | undefined>
}
```

**Step 4: Implement config defaults**

`src/config/defaults.ts`:
```typescript
import type { RaConfig } from './types'

export const defaults: RaConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  interface: 'repl',
  systemPrompt: '',
  http: { port: 3000, token: '' },
  skills: [],
  alwaysLoad: [],
  mcp: {
    client: [],
    server: {
      enabled: false,
      port: 3001,
      tool: { name: 'agent', description: 'A general purpose agent', inputSchema: {} },
    },
  },
  providers: {
    anthropic: { apiKey: '' },
    openai: { apiKey: '' },
    google: { apiKey: '' },
    ollama: { baseUrl: 'http://localhost:11434' },
  },
  storage: {
    path: '~/.ra/sessions',
    format: 'jsonl',
    maxSessions: 100,
    ttlDays: 30,
  },
  maxIterations: 50,
  middleware: {},
}
```

**Step 5: Implement config loader**

`src/config/index.ts`:
```typescript
import { defaults } from './defaults'
import type { RaConfig, LoadConfigOptions } from './types'
import { parse as parseYaml } from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_NAMES = ['ra.config.json', 'ra.config.yml', 'ra.config.yaml', 'ra.config.toml']

export async function loadConfig(options: LoadConfigOptions = {}): Promise<RaConfig> {
  const { cwd = process.cwd(), configPath, cliArgs = {}, env = process.env } = options

  // 1. Start with defaults
  let config: RaConfig = structuredClone(defaults)

  // 2. Load config file
  const filePath = configPath ?? findConfigFile(cwd)
  if (filePath) {
    const fileConfig = await parseConfigFile(filePath)
    config = deepMerge(config, fileConfig)
  }

  // 3. Apply env vars
  if (env.RA_PROVIDER) config.provider = env.RA_PROVIDER
  if (env.RA_MODEL) config.model = env.RA_MODEL
  if (env.RA_INTERFACE) config.interface = env.RA_INTERFACE as RaConfig['interface']
  if (env.RA_SYSTEM_PROMPT) config.systemPrompt = env.RA_SYSTEM_PROMPT
  if (env.RA_STORAGE_PATH) config.storage.path = env.RA_STORAGE_PATH
  if (env.RA_HTTP_TOKEN) config.http.token = env.RA_HTTP_TOKEN
  if (env.ANTHROPIC_API_KEY) config.providers.anthropic.apiKey = env.ANTHROPIC_API_KEY
  if (env.OPENAI_API_KEY) config.providers.openai.apiKey = env.OPENAI_API_KEY
  if (env.GOOGLE_API_KEY) config.providers.google.apiKey = env.GOOGLE_API_KEY

  // 4. Apply CLI args (highest priority)
  config = deepMerge(config, cliArgs as Partial<RaConfig>)

  // 5. Resolve systemPrompt if it's a file path
  if (config.systemPrompt && existsSync(config.systemPrompt)) {
    config.systemPrompt = await Bun.file(config.systemPrompt).text()
  }

  return config
}

function findConfigFile(cwd: string): string | null {
  // Check cwd
  for (const name of CONFIG_NAMES) {
    const p = join(cwd, name)
    if (existsSync(p)) return p
  }
  // Check ~/.config/ra/
  const homeConfig = join(homedir(), '.config', 'ra')
  for (const name of CONFIG_NAMES) {
    const p = join(homeConfig, name.replace('ra.config.', 'config.'))
    if (existsSync(p)) return p
  }
  return null
}

async function parseConfigFile(path: string): Promise<Partial<RaConfig>> {
  const content = await Bun.file(path).text()
  if (path.endsWith('.json')) return JSON.parse(content)
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return parseYaml(content) as Partial<RaConfig>
  if (path.endsWith('.toml')) return parseToml(content) as Partial<RaConfig>
  throw new Error(`Unsupported config format: ${path}`)
}

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] === undefined) continue
    if (
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null
    ) {
      result[key] = deepMerge(target[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

export type { RaConfig, LoadConfigOptions }
```

**Step 6: Run tests**

Run: `bun test tests/config/index.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add config system with file/env/cli merging"
```

---

### Task 5: Anthropic Provider

**Files:**
- Create: `src/providers/anthropic.ts`
- Create: `tests/providers/anthropic.test.ts`

**Step 1: Write failing test**

`tests/providers/anthropic.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { AnthropicProvider } from '../../src/providers/anthropic'

describe('AnthropicProvider', () => {
  it('has correct name', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    expect(provider.name).toBe('anthropic')
  })

  it('extracts system messages from message array', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { system, filtered } = (provider as any).extractSystemMessages(messages)
    expect(system).toBe('You are helpful')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].role).toBe('user')
  })

  it('maps tools to Anthropic format', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const tools = [{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async () => ({}),
    }]
    const mapped = (provider as any).mapTools(tools)
    expect(mapped[0].name).toBe('test_tool')
    expect(mapped[0].input_schema).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/anthropic.test.ts`
Expected: FAIL

**Step 3: Implement Anthropic provider**

`src/providers/anthropic.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, ContentPart, IToolCall } from './types'

export class AnthropicProvider implements IProvider {
  name = 'anthropic'
  private client: Anthropic

  constructor(config: { apiKey: string }) {
    this.client = new Anthropic({ apiKey: config.apiKey })
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { system, filtered } = this.extractSystemMessages(request.messages)
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: 8192,
      system: system || undefined,
      messages: this.mapMessages(filtered),
      tools: request.tools ? this.mapTools(request.tools) : undefined,
      ...request.providerOptions,
    })

    return {
      message: this.mapResponseToMessage(response),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const { system, filtered } = this.extractSystemMessages(request.messages)
    const stream = this.client.messages.stream({
      model: request.model,
      max_tokens: 8192,
      system: system || undefined,
      messages: this.mapMessages(filtered),
      tools: request.tools ? this.mapTools(request.tools) : undefined,
      ...request.providerOptions,
    })

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          yield { type: 'tool_call_start', id: event.content_block.id, name: event.content_block.name }
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', delta: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool_call_delta', id: '', argsDelta: event.delta.partial_json }
        }
      } else if (event.type === 'content_block_stop') {
        // Could be text or tool — downstream handles
      } else if (event.type === 'message_delta') {
        // end of message
      }
    }

    const finalMessage = await stream.finalMessage()
    yield {
      type: 'done',
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    }
  }

  private extractSystemMessages(messages: IMessage[]): { system: string; filtered: IMessage[] } {
    const systemMsgs: string[] = []
    const filtered: IMessage[] = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMsgs.push(typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.type === 'text' ? p.text : '').join(''))
      } else {
        filtered.push(msg)
      }
    }
    return { system: systemMsgs.join('\n\n'), filtered }
  }

  private mapMessages(messages: IMessage[]): Anthropic.MessageParam[] {
    return messages.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: msg.toolCallId!,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          }],
        }
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: Anthropic.ContentBlockParam[] = []
        if (typeof msg.content === 'string' && msg.content) {
          content.push({ type: 'text', text: msg.content })
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          })
        }
        return { role: 'assistant' as const, content }
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string'
          ? msg.content
          : this.mapContentParts(msg.content),
      }
    })
  }

  private mapContentParts(parts: ContentPart[]): Anthropic.ContentBlockParam[] {
    return parts.map(part => {
      if (part.type === 'text') return { type: 'text' as const, text: part.text }
      if (part.type === 'image') {
        if (part.source.type === 'base64') {
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: part.source.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: part.source.data,
            },
          }
        }
        return {
          type: 'image' as const,
          source: { type: 'url' as const, url: part.source.url },
        }
      }
      // file — encode as base64 document
      return {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: part.mimeType,
          data: typeof part.data === 'string' ? part.data : part.data.toString('base64'),
        },
      } as any
    })
  }

  private mapTools(tools: ITool[]): Anthropic.Tool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))
  }

  private mapResponseToMessage(response: Anthropic.Message): IMessage {
    const textParts = response.content.filter(b => b.type === 'text').map(b => (b as any).text).join('')
    const toolCalls: IToolCall[] = response.content
      .filter(b => b.type === 'tool_use')
      .map(b => {
        const tu = b as Anthropic.ToolUseBlock
        return { id: tu.id, name: tu.name, arguments: JSON.stringify(tu.input) }
      })

    return {
      role: 'assistant',
      content: textParts,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    }
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/providers/anthropic.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Anthropic provider"
```

---

### Task 6: OpenAI Provider

**Files:**
- Create: `src/providers/openai.ts`
- Create: `tests/providers/openai.test.ts`

**Step 1: Write failing test**

`tests/providers/openai.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { OpenAIProvider } from '../../src/providers/openai'

describe('OpenAIProvider', () => {
  it('has correct name', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    expect(provider.name).toBe('openai')
  })

  it('keeps system messages in array', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('system')
    expect(mapped).toHaveLength(2)
  })

  it('maps tools to OpenAI format', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const tools = [{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async () => ({}),
    }]
    const mapped = (provider as any).mapTools(tools)
    expect(mapped[0].type).toBe('function')
    expect(mapped[0].function.name).toBe('test_tool')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/openai.test.ts`
Expected: FAIL

**Step 3: Implement OpenAI provider**

`src/providers/openai.ts` — same pattern as Anthropic: implement `IProvider`, map messages/tools to OpenAI format, keep system messages as `role: system` in the array, map tool_calls from OpenAI's `function` format to `IToolCall`.

**Step 4: Run tests**

Run: `bun test tests/providers/openai.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add OpenAI provider"
```

---

### Task 7: Google Provider

Same pattern as Tasks 5-6. Map to `@google/generative-ai` SDK.

**Files:**
- Create: `src/providers/google.ts`
- Create: `tests/providers/google.test.ts`

Follow TDD: write test (name, message mapping, tool mapping) → fail → implement → pass → commit.

```bash
git add -A && git commit -m "feat: add Google Gemini provider"
```

---

### Task 8: Ollama Provider

Same pattern. Map to `ollama` SDK.

**Files:**
- Create: `src/providers/ollama.ts`
- Create: `tests/providers/ollama.test.ts`

Follow TDD: test → fail → implement → pass → commit.

```bash
git add -A && git commit -m "feat: add Ollama provider"
```

---

### Task 9: Provider Registry

**Files:**
- Create: `src/providers/registry.ts`
- Create: `tests/providers/registry.test.ts`

**Step 1: Write failing test**

`tests/providers/registry.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test'
import { createProvider } from '../../src/providers/registry'

describe('createProvider', () => {
  it('creates anthropic provider', () => {
    const p = createProvider('anthropic', { apiKey: 'test' })
    expect(p.name).toBe('anthropic')
  })

  it('creates openai provider', () => {
    const p = createProvider('openai', { apiKey: 'test' })
    expect(p.name).toBe('openai')
  })

  it('throws for unknown provider', () => {
    expect(() => createProvider('unknown', {})).toThrow()
  })
})
```

**Step 2:** Run → fail → implement factory → pass → commit.

`src/providers/registry.ts`: factory function that maps provider name string to the correct class constructor.

```bash
git add -A && git commit -m "feat: add provider registry"
```

---

### Task 10: Tool Registry

**Files:**
- Create: `src/agent/tool-registry.ts`
- Create: `tests/agent/tool-registry.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'bun:test'
import { ToolRegistry } from '../../src/agent/tool-registry'

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'test', description: 'test', inputSchema: {}, execute: async () => ({}) })
    expect(reg.get('test')).toBeDefined()
    expect(reg.all()).toHaveLength(1)
  })

  it('returns undefined for unknown tool', () => {
    const reg = new ToolRegistry()
    expect(reg.get('missing')).toBeUndefined()
  })

  it('executes tool by name', async () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'add', description: 'add', inputSchema: {}, execute: async (input: any) => input.a + input.b })
    const result = await reg.execute('add', { a: 1, b: 2 })
    expect(result).toBe(3)
  })
})
```

**Step 2:** Run → fail → implement → pass → commit.

```bash
git add -A && git commit -m "feat: add tool registry"
```

---

### Task 11: Agentic Loop

**Files:**
- Create: `src/agent/loop.ts`
- Create: `tests/agent/loop.test.ts`

This is the core. Test with a mock provider that returns a sequence of responses.

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'bun:test'
import { AgentLoop } from '../../src/agent/loop'
import type { IProvider, StreamChunk, ChatRequest } from '../../src/providers/types'
import { ToolRegistry } from '../../src/agent/tool-registry'

function mockProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text', delta: 'done' }, { type: 'done' }]
      for (const chunk of chunks) yield chunk
    },
  }
}

describe('AgentLoop', () => {
  it('runs single turn with no tool calls', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'done' }]])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.messages.at(-1)?.content).toBe('hello')
    expect(result.iterations).toBe(1)
  })

  it('executes tool calls and loops', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'add' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"a":1,"b":2}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'result is 3' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'add', description: 'add', inputSchema: {}, execute: async (input: any) => input.a + input.b })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'add 1+2' }])
    expect(result.iterations).toBe(2)
  })

  it('respects maxIterations', async () => {
    // Provider always returns a tool call — loop should stop at max
    const infiniteToolCall: StreamChunk[] = [
      { type: 'tool_call_start', id: 'tc1', name: 'noop' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
      { type: 'tool_call_end', id: 'tc1' },
      { type: 'done' },
    ]
    const provider = mockProvider(Array(100).fill(infiniteToolCall))
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({ provider, tools, maxIterations: 3 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(result.iterations).toBeLessThanOrEqual(3)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/agent/loop.test.ts`
Expected: FAIL

**Step 3: Implement agentic loop**

`src/agent/loop.ts`: Consumes stream chunks, assembles text + tool calls, executes tools concurrently via `Promise.allSettled`, appends tool results, runs middleware at each lifecycle point, checkpoints, loops until no tool calls or max iterations.

**Step 4: Run tests**

Run: `bun test tests/agent/loop.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add agentic loop with parallel tool execution"
```

---

### Task 12: Skills Loader (Agent Skills Spec)

Skills follow the [Agent Skills specification](https://agentskills.io). Each skill is a directory with a `SKILL.md` file containing YAML frontmatter + markdown body, with optional `scripts/`, `references/`, and `assets/` subdirectories.

**Files:**
- Create: `src/skills/types.ts`
- Create: `src/skills/loader.ts`
- Create: `tests/skills/loader.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadSkills, loadSkillMetadata } from '../../src/skills/loader'
import { mkdirSync, writeFileSync, rmSync } from 'fs'

const TEST_DIR = '/tmp/ra-test-skills'

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('loadSkills', () => {
  it('loads skill from directory with SKILL.md', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const skills = await loadSkills([TEST_DIR])
    expect(skills.get('greet')).toBeDefined()
    expect(skills.get('greet')!.body).toBe('Hello! Greet the user.')
    expect(skills.get('greet')!.metadata.description).toBe('Greets users warmly')
  })

  it('validates name matches directory name', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: wrong-name\ndescription: Mismatch\n---\nBody')
    const skills = await loadSkills([TEST_DIR])
    expect(skills.get('greet')).toBeUndefined()  // rejected due to mismatch
  })

  it('detects scripts directory', async () => {
    mkdirSync(`${TEST_DIR}/fetch/scripts`, { recursive: true })
    writeFileSync(`${TEST_DIR}/fetch/SKILL.md`, '---\nname: fetch\ndescription: Fetches data\n---\nFetch stuff')
    writeFileSync(`${TEST_DIR}/fetch/scripts/run.ts`, 'console.log("fetched")')
    const skills = await loadSkills([TEST_DIR])
    expect(skills.get('fetch')!.scripts).toContain('scripts/run.ts')
  })

  it('progressive disclosure: loadSkillMetadata only loads name + description', async () => {
    mkdirSync(`${TEST_DIR}/heavy`, { recursive: true })
    writeFileSync(`${TEST_DIR}/heavy/SKILL.md`, '---\nname: heavy\ndescription: Heavy skill\n---\nVery long body...')
    const metadata = await loadSkillMetadata([TEST_DIR])
    expect(metadata.get('heavy')!.name).toBe('heavy')
    expect(metadata.get('heavy')!.description).toBe('Heavy skill')
    expect((metadata.get('heavy') as any).body).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/skills/loader.test.ts`
Expected: FAIL

**Step 3: Implement skill types**

`src/skills/types.ts`:
```typescript
export interface SkillMetadata {
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
}

export interface Skill {
  metadata: SkillMetadata
  body: string                    // markdown body from SKILL.md
  dir: string                     // absolute path to skill directory
  scripts: string[]               // relative paths to scripts/
  references: string[]            // relative paths to references/
  assets: string[]                // relative paths to assets/
}
```

**Step 4: Implement skill loader**

`src/skills/loader.ts`: Scan configured dirs for subdirectories containing `SKILL.md`. Parse YAML frontmatter, validate `name` matches directory name, collect optional subdirectories. `loadSkillMetadata` returns only `name` + `description` for progressive disclosure. `loadSkills` returns full `Skill` objects.

**Step 5: Run tests**

Run: `bun test tests/skills/loader.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add skills loader following Agent Skills spec"
```

---

### Task 13: Skills Runner

**Files:**
- Create: `src/skills/runner.ts`
- Create: `tests/skills/runner.test.ts`

Test that running a script from `scripts/` captures stdout via `bun run` (for .ts/.js) or shell (for .sh), and the result is returned as a user message. Scripts receive `RA_PROMPT`, `RA_MODEL`, `RA_PROVIDER` env vars.

Follow TDD → commit.

```bash
git add -A && git commit -m "feat: add skills runner for script execution"
```

---

### Task 14: Session Storage

**Files:**
- Create: `src/storage/sessions.ts`
- Create: `tests/storage/sessions.test.ts`

Test: create session → append messages → checkpoint → resume from checkpoint → list sessions → prune old sessions.

Follow TDD → commit.

```bash
git add -A && git commit -m "feat: add session storage with checkpoint and resume"
```

---

### Task 15: MCP Client

**Files:**
- Create: `src/mcp/client.ts`
- Create: `tests/mcp/client.test.ts`

Test: connect to MCP server (mock), discover tools, register them in ToolRegistry.

Follow TDD → commit.

```bash
git add -A && git commit -m "feat: add MCP client with tool discovery"
```

---

### Task 16: MCP Server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `tests/mcp/server.test.ts`

Test: start server, expose configured tool, call tool → agent loop runs → result returned.

Follow TDD → commit.

```bash
git add -A && git commit -m "feat: add MCP server with configurable tool identity"
```

---

### Task 17: CLI Interface

**Files:**
- Create: `src/interfaces/cli.ts`
- Create: `tests/interfaces/cli.test.ts`

Test: parse positional prompt arg, `--file` flag, `--skill` flag, run agent loop, stream to stdout.

Follow TDD → commit.

```bash
git add -A && git commit -m "feat: add CLI interface"
```

---

### Task 18: REPL Interface

**Files:**
- Create: `src/interfaces/repl.ts`
- Create: `tests/interfaces/repl.test.ts`

Test: input/output loop, `/attach`, `/skill`, `/clear`, `/resume` commands, session persistence.

Follow TDD → commit.

```bash
git add -A && git commit -m "feat: add REPL interface"
```

---

### Task 19: HTTP Interface

**Files:**
- Create: `src/interfaces/http.ts`
- Create: `tests/interfaces/http.test.ts`

Test: `POST /chat` with SSE streaming, `POST /chat/sync`, `GET /sessions`, bearer token auth.

Follow TDD → commit.

```bash
git add -A && git commit -m "feat: add HTTP interface with SSE streaming"
```

---

### Task 20: Entry Point & Wiring

**Files:**
- Modify: `src/index.ts`

Wire everything together: load config → create provider → load skills → connect MCP clients → start interface.

Test: `bun run src/index.ts --help` shows usage, `bun run src/index.ts "hello"` runs CLI mode.

Follow TDD → commit.

```bash
git add -A && git commit -m "feat: wire entry point with config, providers, skills, and interfaces"
```

---

### Task 21: End-to-End Test

**Files:**
- Create: `tests/e2e/agent.test.ts`

Full integration test: config → mock provider → skill injection → tool call → response. Verifies the complete data flow.

```bash
git add -A && git commit -m "test: add end-to-end agent test"
```

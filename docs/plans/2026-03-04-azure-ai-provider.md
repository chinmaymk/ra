# Azure AI Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Azure OpenAI support via an `AzureProvider` subclass that extends `OpenAIProvider`, reusing all message/tool mapping logic and supporting both API key and `DefaultAzureCredential` auth.

**Architecture:** `AzureProvider extends OpenAIProvider` — make `client` and `buildParams` protected in `OpenAIProvider`, then override the constructor (builds `AzureOpenAI` with either API key or `DefaultAzureCredential`) and `buildParams` (replaces `model` with deployment name). Wire through config types, defaults, env vars, CLI flags, and the provider registry.

**Tech Stack:** `@azure/openai` (AzureOpenAI client, extends openai SDK), `@azure/identity` (DefaultAzureCredential), `bun test` for tests.

---

### Task 1: Install Azure dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install the packages**

```bash
bun add @azure/openai @azure/identity
```

**Step 2: Verify they appear in package.json**

```bash
grep -E "@azure/(openai|identity)" package.json
```
Expected: both entries visible with version numbers.

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @azure/openai and @azure/identity dependencies"
```

---

### Task 2: Make OpenAIProvider extensible

**Files:**
- Modify: `src/providers/openai.ts:11,17`
- Test: `tests/providers/openai.test.ts`

The `client` field is `private` and `buildParams` is `private`. Subclasses need `protected` access for both.

**Step 1: Write a failing test verifying subclass can access `buildParams`**

Add to `tests/providers/openai.test.ts`:

```typescript
describe('OpenAIProvider - extensibility', () => {
  it('allows subclass to override buildParams', () => {
    class TestProvider extends OpenAIProvider {
      protected override buildParams(request: any) {
        return { ...super.buildParams(request), model: 'overridden' }
      }
    }
    const p = new TestProvider({ apiKey: 'test' })
    const params = (p as any).buildParams({
      model: 'original',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(params.model).toBe('overridden')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/providers/openai.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: TypeScript error — `buildParams` is private and cannot be overridden.

**Step 3: Change `private` to `protected` in OpenAIProvider**

In `src/providers/openai.ts`, change line 11:
```typescript
// Before:
private client: OpenAI
// After:
protected client: OpenAI
```

Change line 17:
```typescript
// Before:
private buildParams(request: ChatRequest): OpenAI.Chat.ChatCompletionCreateParams {
// After:
protected buildParams(request: ChatRequest): OpenAI.Chat.ChatCompletionCreateParams {
```

**Step 4: Run all OpenAI tests**

```bash
bun test tests/providers/openai.test.ts --reporter=verbose
```
Expected: All tests pass including new extensibility test.

**Step 5: Commit**

```bash
git add src/providers/openai.ts tests/providers/openai.test.ts
git commit -m "refactor: make OpenAIProvider client and buildParams protected for subclassing"
```

---

### Task 3: Create AzureProviderOptions type and AzureProvider class

**Files:**
- Create: `src/providers/azure.ts`
- Create: `tests/providers/azure.test.ts`

**Step 1: Write failing tests for AzureProvider**

Create `tests/providers/azure.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { AzureProvider } from '../../src/providers/azure'

describe('AzureProvider', () => {
  it('has name azure', () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'gpt-4o' })
    expect(p.name).toBe('azure')
  })

  it('uses deployment as model in buildParams', () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'my-gpt4o' })
    const params = (p as any).buildParams({
      model: 'should-be-ignored',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(params.model).toBe('my-gpt4o')
  })

  it('inherits message mapping from OpenAIProvider', () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'gpt-4o' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const mapped = (p as any).mapMessages(messages)
    expect(mapped[0].role).toBe('system')
    expect(mapped).toHaveLength(2)
  })

  it('inherits tool mapping from OpenAIProvider', () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'gpt-4o' })
    const tools = [{
      name: 'my_tool',
      description: 'does stuff',
      inputSchema: { type: 'object' },
      execute: async () => ({}),
    }]
    const mapped = (p as any).mapTools(tools)
    expect(mapped[0].type).toBe('function')
    expect(mapped[0].function.name).toBe('my_tool')
  })

  it('supports chat via mocked client', async () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'gpt-4o' })
    ;(p as any).client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { role: 'assistant', content: 'Azure response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        },
      },
    }
    const result = await p.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.message.content).toBe('Azure response')
    expect(result.usage?.inputTokens).toBe(10)
  })

  it('supports streaming via mocked client', async () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'gpt-4o' })
    ;(p as any).client = {
      chat: {
        completions: {
          create: async () => (async function* () {
            yield { choices: [{ delta: { content: 'Hello' } }] }
            yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } }
          })(),
        },
      },
    }
    const chunks: any[] = []
    for await (const chunk of p.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    const done = chunks.find((c: any) => c.type === 'done')
    expect(done).toBeDefined()
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/providers/azure.test.ts --reporter=verbose 2>&1 | tail -10
```
Expected: Error — `../../src/providers/azure` not found.

**Step 3: Create `src/providers/azure.ts`**

```typescript
import { AzureOpenAI } from '@azure/openai'
import { DefaultAzureCredential } from '@azure/identity'
import { OpenAIProvider } from './openai'
import type { ChatRequest } from './types'

export interface AzureProviderOptions {
  endpoint: string
  deployment: string
  apiKey?: string
  apiVersion?: string
}

export class AzureProvider extends OpenAIProvider {
  name = 'azure'
  private deployment: string

  constructor(options: AzureProviderOptions) {
    super({ apiKey: '' })
    this.deployment = options.deployment

    if (options.apiKey) {
      this.client = new AzureOpenAI({
        endpoint: options.endpoint,
        apiKey: options.apiKey,
        deployment: options.deployment,
        apiVersion: options.apiVersion,
      }) as any
    } else {
      this.client = new AzureOpenAI({
        endpoint: options.endpoint,
        credential: new DefaultAzureCredential(),
        deployment: options.deployment,
        apiVersion: options.apiVersion,
      }) as any
    }
  }

  protected override buildParams(request: ChatRequest) {
    return { ...super.buildParams(request), model: this.deployment }
  }
}
```

**Step 4: Run tests**

```bash
bun test tests/providers/azure.test.ts --reporter=verbose
```
Expected: All 6 tests pass.

**Step 5: Commit**

```bash
git add src/providers/azure.ts tests/providers/azure.test.ts
git commit -m "feat: add AzureProvider extending OpenAIProvider"
```

---

### Task 4: Register Azure in config types and defaults

**Files:**
- Modify: `src/config/types.ts:1-7,21-27`
- Modify: `src/config/defaults.ts:22-28`

**Step 1: Write a failing test for azure defaults**

Add to `tests/config/index.test.ts` inside the `describe('loadConfig', ...)` block:

```typescript
it('includes azure provider defaults', async () => {
  const c = await loadConfig({ cwd: tmp })
  expect(c.providers.azure).toBeDefined()
  expect(c.providers.azure.endpoint).toBe('')
  expect(c.providers.azure.deployment).toBe('')
})
```

**Step 2: Run to confirm it fails**

```bash
bun test tests/config/index.test.ts --reporter=verbose 2>&1 | grep -E "azure|FAIL|pass"
```
Expected: TypeScript error — `azure` does not exist on `providers`.

**Step 3: Update `src/config/types.ts`**

```typescript
// Line 1-7: add import and update ProviderName
import type { AnthropicProviderOptions } from '../providers/anthropic'
import type { OpenAIProviderOptions } from '../providers/openai'
import type { GoogleProviderOptions } from '../providers/google'
import type { OllamaProviderOptions } from '../providers/ollama'
import type { BedrockProviderOptions } from '../providers/bedrock'
import type { AzureProviderOptions } from '../providers/azure'

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'ollama' | 'bedrock' | 'azure'
```

Add `azure: AzureProviderOptions` to the `providers` map in `RaConfig` (after `bedrock`):
```typescript
  providers: {
    anthropic: AnthropicProviderOptions
    openai: OpenAIProviderOptions
    google: GoogleProviderOptions
    ollama: OllamaProviderOptions
    bedrock: BedrockProviderOptions
    azure: AzureProviderOptions
  }
```

**Step 4: Update `src/config/defaults.ts`**

Add `azure` to the providers block (after `bedrock`):
```typescript
    bedrock: { region: 'us-east-1' },
    azure: { endpoint: '', deployment: '', apiKey: '' },
```

**Step 5: Run the test**

```bash
bun test tests/config/index.test.ts --reporter=verbose 2>&1 | grep -E "azure|✓|✗"
```
Expected: new test passes, all existing tests still pass.

**Step 6: Run full test suite to check for regressions**

```bash
bun test --reporter=verbose 2>&1 | tail -20
```
Expected: All tests pass.

**Step 7: Commit**

```bash
git add src/config/types.ts src/config/defaults.ts tests/config/index.test.ts
git commit -m "feat: add azure to ProviderName type and config defaults"
```

---

### Task 5: Add Azure env var support

**Files:**
- Modify: `src/config/index.ts:111-120`
- Test: `tests/config/index.test.ts`

**Step 1: Write failing tests**

Add to `tests/config/index.test.ts` in the env vars section:

```typescript
describe('azure env vars', () => {
  it('RA_AZURE_API_KEY sets providers.azure.apiKey', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_API_KEY: 'my-key' } })
    expect(c.providers.azure.apiKey).toBe('my-key')
  })

  it('RA_AZURE_ENDPOINT sets providers.azure.endpoint', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_ENDPOINT: 'https://myresource.openai.azure.com/' } })
    expect(c.providers.azure.endpoint).toBe('https://myresource.openai.azure.com/')
  })

  it('RA_AZURE_DEPLOYMENT sets providers.azure.deployment', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_DEPLOYMENT: 'my-gpt4o' } })
    expect(c.providers.azure.deployment).toBe('my-gpt4o')
  })

  it('RA_AZURE_API_VERSION sets providers.azure.apiVersion', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_API_VERSION: '2024-12-01-preview' } })
    expect(c.providers.azure.apiVersion).toBe('2024-12-01-preview')
  })
})
```

**Step 2: Run to confirm failure**

```bash
bun test tests/config/index.test.ts --reporter=verbose 2>&1 | grep -E "azure|FAIL"
```
Expected: all 4 new tests fail (env vars have no effect yet).

**Step 3: Add env var handling to `src/config/index.ts`**

After line 120 (`RA_BEDROCK_API_KEY`), add:

```typescript
  if (env.RA_AZURE_API_KEY !== undefined)   set(['providers', 'azure', 'apiKey'], env.RA_AZURE_API_KEY)
  if (env.RA_AZURE_ENDPOINT !== undefined)  set(['providers', 'azure', 'endpoint'], env.RA_AZURE_ENDPOINT)
  if (env.RA_AZURE_DEPLOYMENT !== undefined) set(['providers', 'azure', 'deployment'], env.RA_AZURE_DEPLOYMENT)
  if (env.RA_AZURE_API_VERSION !== undefined) set(['providers', 'azure', 'apiVersion'], env.RA_AZURE_API_VERSION)
```

**Step 4: Run the tests**

```bash
bun test tests/config/index.test.ts --reporter=verbose 2>&1 | grep -E "azure|✓|✗"
```
Expected: all 4 new tests pass.

**Step 5: Commit**

```bash
git add src/config/index.ts tests/config/index.test.ts
git commit -m "feat: add Azure env var config support (RA_AZURE_*)"
```

---

### Task 6: Add Azure CLI flags

**Files:**
- Modify: `src/interfaces/parse-args.ts:78-82,123-127`
- Test: `tests/config/parse-args.test.ts`

**Step 1: Write failing tests**

Add to `tests/config/parse-args.test.ts` in the provider connection options section:

```typescript
describe('Azure provider flags', () => {
  it('--azure-endpoint sets providers.azure.endpoint', () => {
    const r = parseArgs(dev('--azure-endpoint', 'https://myresource.openai.azure.com/'))
    expect((r.config as any).providers?.azure?.endpoint).toBe('https://myresource.openai.azure.com/')
  })

  it('--azure-deployment sets providers.azure.deployment', () => {
    const r = parseArgs(dev('--azure-deployment', 'my-gpt4o'))
    expect((r.config as any).providers?.azure?.deployment).toBe('my-gpt4o')
  })
})
```

**Step 2: Run to confirm failure**

```bash
bun test tests/config/parse-args.test.ts --reporter=verbose 2>&1 | grep -E "azure|FAIL"
```
Expected: both tests fail — flags unknown or values not mapped.

**Step 3: Add CLI flag definitions in `src/interfaces/parse-args.ts`**

In the `options` object (after `'ollama-host'`), add:
```typescript
      'azure-endpoint':              { type: 'string' },
      'azure-deployment':            { type: 'string' },
```

In the mapping section (after `if (values['ollama-host'])`), add:
```typescript
  if (values['azure-endpoint'])    set(['providers', 'azure', 'endpoint'], values['azure-endpoint'])
  if (values['azure-deployment'])  set(['providers', 'azure', 'deployment'], values['azure-deployment'])
```

**Step 4: Run the tests**

```bash
bun test tests/config/parse-args.test.ts --reporter=verbose 2>&1 | grep -E "azure|✓|✗"
```
Expected: both new tests pass.

**Step 5: Commit**

```bash
git add src/interfaces/parse-args.ts tests/config/parse-args.test.ts
git commit -m "feat: add --azure-endpoint and --azure-deployment CLI flags"
```

---

### Task 7: Register AzureProvider in the registry

**Files:**
- Modify: `src/providers/registry.ts`

**Step 1: Write a failing test**

Add to `tests/providers/` — create `tests/providers/registry.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { createProvider, buildProviderConfig } from '../../src/providers/registry'
import { AzureProvider } from '../../src/providers/azure'

describe('createProvider', () => {
  it('creates AzureProvider for azure', () => {
    const config = buildProviderConfig('azure', {
      endpoint: 'https://test.openai.azure.com/',
      deployment: 'gpt-4o',
    })
    const provider = createProvider(config)
    expect(provider).toBeInstanceOf(AzureProvider)
    expect(provider.name).toBe('azure')
  })
})
```

**Step 2: Run to confirm failure**

```bash
bun test tests/providers/registry.test.ts --reporter=verbose 2>&1 | tail -10
```
Expected: TypeScript error — `'azure'` is not assignable to `ProviderName` in `buildProviderConfig` (or switch falls through).

**Step 3: Update `src/providers/registry.ts`**

Add import at top:
```typescript
import { AzureProvider, type AzureProviderOptions } from './azure'
```

Add `azure` to `ProviderOptionsMap`:
```typescript
type ProviderOptionsMap = {
  anthropic: AnthropicProviderOptions
  openai: OpenAIProviderOptions
  google: GoogleProviderOptions
  ollama: OllamaProviderOptions
  bedrock: BedrockProviderOptions
  azure: AzureProviderOptions
}
```

Add case to `createProvider` switch (after `bedrock`):
```typescript
    case 'azure': {
      const { provider: _, ...opts } = config
      return new AzureProvider(opts)
    }
```

**Step 4: Run the test**

```bash
bun test tests/providers/registry.test.ts --reporter=verbose
```
Expected: test passes.

**Step 5: Run full test suite**

```bash
bun test --reporter=verbose 2>&1 | tail -20
```
Expected: All tests pass.

**Step 6: Check TypeScript**

```bash
bun tsc --noEmit 2>&1 | head -30
```
Expected: No errors.

**Step 7: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: register AzureProvider in provider registry"
```

---

### Task 8: Final verification

**Step 1: Run full test suite**

```bash
bun test --reporter=verbose 2>&1 | tail -30
```
Expected: All tests pass with no failures.

**Step 2: TypeScript check**

```bash
bun tsc --noEmit
```
Expected: No output (no errors).

**Step 3: Smoke test — verify azure appears as a valid provider**

```bash
bun src/index.ts --provider azure --help 2>&1 | grep -i azure || echo "check help output manually"
```

**Step 4: Final commit if any loose ends**

If README needs updating (azure in provider list and env var table):
- Add `azure` row to the providers table in `README.md`
- Add env var rows: `RA_AZURE_API_KEY`, `RA_AZURE_ENDPOINT`, `RA_AZURE_DEPLOYMENT`, `RA_AZURE_API_VERSION`

```bash
git add README.md
git commit -m "docs: add Azure provider to README"
```

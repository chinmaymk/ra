---
name: add-provider
description: Use when adding a new LLM provider to ra.
---

# Adding a Provider

All 6 providers follow the same pattern. Use an existing one as a template — `anthropic.ts` is the cleanest.

## Files to Touch

1. **`src/providers/<name>.ts`** — Provider class implementing `IProvider`
2. **`src/providers/registry.ts`** — Add to `ProviderOptionsMap`, import, and add `case` to `createProvider()`
3. **`src/config/types.ts`** — Add to `ProviderName` union and `providers` field in `RaConfig`
4. **`src/config/defaults.ts`** — Add default options under `providers`
5. **`src/config/index.ts`** — Add env var mapping (e.g., `RA_<NAME>_API_KEY`)
6. **`tests/providers/<name>.test.ts`** — Tests mocking the SDK client

## Provider Class Pattern

```ts
import type { IProvider, ChatRequest, ChatResponse, StreamChunk } from './types'

export interface XProviderOptions {
  apiKey: string
  // provider-specific options
}

export class XProvider implements IProvider {
  readonly name = 'x'
  private client: SdkClient

  constructor(options: XProviderOptions) {
    this.client = new SdkClient({ apiKey: options.apiKey })
  }

  buildParams(request: ChatRequest) {
    // Map ra's ChatRequest to SDK-specific params
    return {
      model: request.model,
      messages: this.mapMessages(request.messages),
      ...(request.tools?.length && { tools: this.mapTools(request.tools) }),
      ...(request.thinking && { /* provider-specific thinking config */ }),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> { /* ... */ }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    // Must yield: text, tool_call_start, tool_call_delta, tool_call_end, done
    // done chunk should include usage if available
  }

  mapMessages(messages: IMessage[]) { /* ra messages → SDK messages */ }
  mapTools(tools: ITool[]) { /* ra tools → SDK tools */ }
  mapResponseToMessage(response: SdkResponse): IMessage { /* SDK response → ra message */ }
}
```

## Key Points

- `stream()` is the primary method — the loop uses streaming. `chat()` is secondary.
- Every `stream()` must yield a `{ type: 'done' }` chunk at the end, even if the SDK doesn't emit one.
- Tool call IDs must be preserved exactly — they're used to match results back.
- `buildParams()` is a separate method so tests can inspect the request without mocking the SDK.
- Use optional spread for conditional fields: `...(x && { key: x })`.

## Verification

1. `bun tsc` — no type errors
2. `bun test` — new and existing tests pass
3. `bun run ra --provider <name> --model <model> "Hello"` — smoke test

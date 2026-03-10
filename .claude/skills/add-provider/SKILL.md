---
name: add-provider
description: Use when adding a new LLM provider to ra.
---

# Adding a Provider

See `src/providers/CLAUDE.md` for the adapter pattern and StreamChunk contract. Use `anthropic.ts` as a template.

## Checklist

1. **`src/providers/<name>.ts`** — Provider class:

```ts
import type { IProvider, ChatRequest, ChatResponse, StreamChunk } from './types'

export interface XProviderOptions {
  apiKey: string
}

export class XProvider implements IProvider {
  readonly name = 'x'
  private client: SdkClient

  constructor(options: XProviderOptions) {
    this.client = new SdkClient({ apiKey: options.apiKey })
  }

  buildParams(request: ChatRequest) {
    return {
      model: request.model,
      messages: this.mapMessages(request.messages),
      ...(request.tools?.length && { tools: this.mapTools(request.tools) }),
      ...(request.thinking && { /* provider-specific thinking config */ }),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> { /* ... */ }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    // Must yield: text, tool_call_start, tool_call_delta*, tool_call_end, done
    // done chunk MUST include usage if available
  }

  private mapMessages(messages: IMessage[]) { /* ra → SDK */ }
  private mapTools(tools: ITool[]) { /* ra → SDK */ }
  private mapResponseToMessage(response: SdkResponse): IMessage { /* SDK → ra */ }
}
```

2. **`src/providers/registry.ts`** — Add to `ProviderOptionsMap`, import class, add `case` to `createProvider()`

3. **`src/config/types.ts`** — Add to `ProviderName` union and `providers` field in `RaConfig`

4. **`src/config/defaults.ts`** — Add default options under `providers`

5. **`src/config/index.ts`** — Add env var mapping (`RA_<NAME>_API_KEY`)

6. **`tests/providers/<name>.test.ts`** — Mock the SDK client, test `buildParams()`, `stream()` chunk sequence

7. **Verify**: `bun tsc` → `bun test` → `bun run ra --provider <name> --model <model> "Hello"`

## Rules

- `stream()` is primary — the loop always uses streaming. `chat()` is secondary.
- Every `stream()` must yield a `{ type: 'done' }` chunk at the end, even if the SDK doesn't emit one.
- Tool call IDs must be preserved exactly — they match results back to calls.
- `buildParams()` should be a separate method so tests can inspect requests without mocking the SDK.
- Use optional spread: `...(x && { key: x })`.

# src/providers/

LLM provider adapters. Each maps ra's unified types to a specific SDK.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Core interfaces: `IProvider`, `IMessage`, `ITool`, `StreamChunk`, `ChatRequest`, `ChatResponse` |
| `registry.ts` | `createProvider(name, options)` factory — switch on provider name, return `IProvider` |
| `anthropic.ts` | Anthropic (Claude) — supports extended thinking, cache control hints |
| `openai.ts` | Barrel re-export — `OpenAIProvider` (Responses API, default) + `OpenAICompletionsProvider` |
| `openai-responses.ts` | OpenAI Responses API (`POST /responses`) — default for `openai` provider |
| `openai-completions.ts` | OpenAI Chat Completions API (`POST /chat/completions`) — legacy, available as `openai-completions` |
| `google.ts` | Google (Gemini) |
| `ollama.ts` | Ollama (local models) |
| `bedrock.ts` | AWS Bedrock |
| `azure.ts` | Azure OpenAI |
| `anthropic-agents-sdk.ts` | Anthropic Agent SDK — fresh subprocess per turn, XML-tagged conversation history, `maxTurns=1` (subscription-based, no API key) |
| `utils.ts` | `accumulateUsage()` — merges `TokenUsage` objects |

## Provider Implementation Pattern

Every provider class:
1. Implements `IProvider` with `name`, `chat()`, `stream()`
2. Has internal helpers: `buildParams()`, `mapMessages()`, `mapTools()`, `mapResponseToMessage()`
3. `stream()` is the primary method — the loop uses streaming
4. `stream()` must always yield a `{ type: 'done' }` chunk at the end
5. Tool call IDs must be preserved exactly

```
ra ChatRequest → buildParams() → SDK-specific params → SDK call
SDK response → mapResponseToMessage() → ra IMessage
SDK stream → yield StreamChunk sequence → { type: 'done', usage }
```

## StreamChunk Sequence

A valid stream yields chunks in this order:
```
text* → (tool_call_start → tool_call_delta* → tool_call_end)* → done
```
Thinking chunks (`{ type: 'thinking' }`) may interleave with text.

# Context Window Compaction Design

## Problem

The agentic loop sends the full message history every request. As conversations grow, they exceed the model's context window, causing API errors or degraded performance. There is currently no token tracking or context management.

## Solution

A `beforeModelCall` middleware that monitors token usage and automatically compacts messages when approaching the context limit, using LLM summarization.

## Model Registry

Family-level mapping of model prefixes to context window sizes:

```typescript
const MODEL_FAMILIES: Record<string, number> = {
  'claude-3.5': 200_000,
  'claude-3': 200_000,
  'claude-sonnet': 200_000,
  'claude-haiku': 200_000,
  'claude-opus': 200_000,
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5': 16_385,
  'o1': 200_000,
  'o3': 200_000,
  'gemini-2.0': 1_048_576,
  'gemini-1.5': 1_048_576,
  'gemini-2.5': 1_048_576,
}
```

Resolution order:
1. User override via `ProviderConfig.contextWindow`
2. Longest prefix match against model name
3. Global fallback: 128,000 tokens

## Token Estimation

Use `strlen / 4` to estimate token count from message content. This is calculated locally before each model call — no dependency on provider-reported usage metrics.

```typescript
function estimateTokens(messages: IMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === 'string'
      ? m.content
      : JSON.stringify(m.content)
    const toolCalls = m.toolCalls ? JSON.stringify(m.toolCalls) : ''
    return sum + Math.ceil((content.length + toolCalls.length) / 4)
  }, 0)
}
```

## Three-Zone Message Structure

```
┌─────────────────────────────┐
│ PINNED (never compacted)    │
│  - system prompt            │
│  - first user message       │
├─────────────────────────────┤
│ COMPACTABLE → SUMMARY       │
│  - old turns summarized     │
│  - previous summary if any  │
├─────────────────────────────┤
│ RECENT (verbatim)           │
│  - kept verbatim            │
│  - never splits tool pairs  │
└─────────────────────────────┘
```

## Compaction Trigger and Budget

- **Trigger**: `estimateTokens(messages) > contextWindowSize * 0.80`
- **Post-compaction target**: ~20% of context window (pinned + summary), leaving 80% headroom
- Recent zone is trimmed to fit within the 20% budget alongside pinned and summary

## Compaction Algorithm

```
beforeModelCall:
  estimated = estimateTokens(messages)
  if estimated <= threshold: pass through

  pinned = system messages + first user message
  recent = messages from end, adjusted to not split tool-call/tool-result pairs
  middle = everything between pinned and recent

  if middle is empty: pass through (nothing to compact)

  summary = provider.chat({
    messages: [{ role: 'user', content: summarization_prompt(middle) }],
    model: same model
  })

  ctx.request.messages = [
    ...pinned,
    { role: 'user', content: '[Context Summary]\n' + summary },
    ...recent
  ]
```

## Summarization Prompt

The prompt asks the model to preserve:
- Key decisions made
- Important facts and context established
- Current state of the task
- Tool results that are still relevant

## Re-compaction

If a previous `[Context Summary]` message exists in the compactable zone, it gets included in the middle messages for re-summarization. The new summary subsumes the old one.

## Tool Call Integrity

The recent zone boundary is adjusted backward to never split:
- An assistant message with `toolCalls` from its corresponding tool result messages
- A tool result from its originating assistant message

## Configuration

Optional fields on `RaConfig`:
- `compaction.threshold`: trigger ratio (default: 0.80)
- `compaction.maxTokens`: raw token threshold override — when set, compaction triggers at this absolute number instead of `threshold * contextWindowSize`. Useful for models not in the family registry.
- `compaction.enabled`: boolean (default: true)

Optional field on `ProviderConfig`:
- `contextWindow`: override context window size for the provider's model

Resolution for trigger threshold:
1. `compaction.maxTokens` (absolute, highest priority)
2. `compaction.threshold * ProviderConfig.contextWindow`
3. `compaction.threshold * modelFamilyLookup(model)`
4. `compaction.threshold * 128_000` (global fallback)

## What We're Not Building

- No `/compact` command (automatic only)
- No separate summarizer model
- No persistent summary storage
- No dependency on provider-reported token usage (strlen/4 estimation is sufficient)

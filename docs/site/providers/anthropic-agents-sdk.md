# Anthropic Agents SDK (Claude Subscription)

**Provider value:** `anthropic-agents-sdk`

Use your Claude Pro or Max subscription to run ra agents instead of paying per-token API costs. This wraps the [Anthropic Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk) as a model interface — ra owns all context engineering, tool execution, and the agent loop.

::: tip When to use this vs the `anthropic` provider
Use `anthropic` if you have an API key and want per-token billing. Use `anthropic-agents-sdk` if you want to use your Claude subscription instead.
:::

## Setup

### Step 1: Install the Claude CLI

The provider requires the [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated:

```bash
# Install
npm install -g @anthropic-ai/claude-code

# Authenticate (opens browser)
claude login
```

### Step 2: Run

```bash
ra --provider anthropic-agents-sdk "Hello"
```

No API key or environment variables needed — the provider uses your Claude CLI subscription.

## Environment variables

None required. Authentication is handled by the Claude CLI.

## Models

Available models depend on your Claude subscription tier:

| Model | Notes |
|-------|-------|
| `claude-sonnet-4-6` | Default. Fast and capable |
| `claude-opus-4-6` | Most capable |

```bash
ra --provider anthropic-agents-sdk --model claude-opus-4-6 "Design a system"
```

## Extended thinking

Supports extended thinking via the `--thinking` flag:

```bash
ra --provider anthropic-agents-sdk --thinking high "Design a distributed cache"
```

## Config file

```yaml
agent:
  provider: anthropic-agents-sdk
  model: claude-sonnet-4-6
```

## How it works

1. Each `stream()` call spawns a fresh Claude CLI subprocess via the SDK's `query()` function
2. ra's conversation history is serialized as XML-tagged text (`<user>`, `<assistant>`, `<tool_result>`)
3. Tools are registered as MCP schemas with no-op handlers — the model sees them but ra executes them
4. `maxTurns=1` ensures the SDK does exactly one model call per turn, then returns control to ra
5. All SDK context features (memory, dreams, git instructions, session persistence) are disabled — ra owns context

## Limitations

- Requires the Claude CLI installed and on PATH
- Subscription rate limits apply
- Slightly higher latency per turn due to subprocess spawning

## See also

- [Anthropic provider](/providers/anthropic) — for API key-based access
- [Providers overview](/concepts/) — switching between providers
- [Configuration](/configuration/) — provider credentials reference

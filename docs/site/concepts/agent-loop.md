# The Agent Loop

The agent loop is the core of ra. It's a simple cycle: send messages to a model, collect tool calls from the response, execute the tools, feed the results back, and repeat until the model has nothing left to do.

```
User message
  → Model generates a response
    → Response contains tool calls?
      → Yes: execute tools, feed results back → loop
      → No: done
```

That's it. Every agent built with ra follows this pattern.

## How it works

Each iteration of the loop does three things:

1. **Call the model** — send the conversation history (system prompt + messages + tool results) to the LLM provider
2. **Stream the response** — tokens arrive one at a time via server-sent events
3. **Execute tool calls** — if the model requested tools, run them (in parallel by default) and append the results to the conversation

The loop continues until:
- The model responds with plain text and no tool calls (natural completion)
- `maxIterations` is reached
- `maxTokenBudget` or `maxDuration` is exceeded
- Middleware calls `stop()`

## A concrete example

When you run `ra "List the files in src/"`, here's what happens:

1. ra sends your message to the model
2. The model responds with a `Bash` tool call: `ls src/`
3. ra executes the command and captures the output
4. The output goes back to the model
5. The model responds with a summary — no more tool calls
6. Loop ends, you see the result

If the model needed multiple steps (say, reading a file and then editing it), it would just keep requesting tools, and the loop would keep running.

## Middleware hooks

The loop exposes hooks at every stage so you can observe or modify behavior without changing the core:

| Hook | When it fires |
|------|---------------|
| `beforeLoopBegin` | Once, before the first iteration |
| `beforeModelCall` | Before each LLM call (can modify messages and tools) |
| `onStreamChunk` | For each streaming token |
| `afterModelResponse` | After the model finishes responding |
| `beforeToolExecution` | Before each tool runs (can deny execution) |
| `afterToolExecution` | After each tool completes |
| `afterLoopIteration` | After each full iteration |
| `afterLoopComplete` | Once, when the loop ends |
| `onError` | When an error occurs |

See [Middleware](/middleware/) for details on writing hooks.

## Parallel tool calls

When the model requests multiple tools in a single response, ra executes them concurrently by default. This means an agent that needs to read three files doesn't wait for each one sequentially — it reads all three at once.

Disable this with `parallelToolCalls: false` in your config if you need sequential execution.

## Configuration

```yaml
agent:
  maxIterations: 50        # 0 = unlimited
  maxTokenBudget: 500000   # 0 = unlimited
  maxDuration: 300000      # 5 minutes, in ms
  parallelToolCalls: true  # default
```

See [The Agent Loop reference](/core/agent-loop) for the full specification.

# Dynamic Prompts Design

**Date:** 2026-03-04
**Status:** Approved
**Approach:** Documentation-only — no new code concepts

## Decision

Dynamic prompts are achieved through existing `beforeModelCall` middleware. No new config keys, abstractions, or lifecycle concepts are needed.

Users write middleware functions that receive structured context (`ModelCallContext`) and modify `ctx.request.messages` or `ctx.request.tools` before each model call.

## Rationale

- `beforeModelCall` middleware already runs before every LLM call with full access to messages and tools
- Adding a `dynamicPrompts` config key would create a fourth prompt concept (alongside `systemPrompt`, skills, and middleware) with significant overlap
- The imperative approach (scripts with structured context) was preferred over declarative config rules

## Deliverables

Documentation recipes covering four patterns:

1. **Runtime Context Injection** — inject dynamic data (files, env, command output) as system messages
2. **Conditional Prompt Sections** — add/remove instructions based on conversation state
3. **Reactive Prompt Adaptation** — adjust behavior based on tool results, errors, iteration count
4. **Dynamic Tool Filtering** — modify `ctx.request.tools` to enable/disable tools based on context

Each recipe includes a middleware TypeScript file and the config YAML to wire it up.

## Key Design Points

- Scripts run before **every** model call (not just once)
- Return `null` or skip modification to inject nothing
- Multiple middleware compose in array order
- Uses existing `ModelCallContext` type — no new types needed

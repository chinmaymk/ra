# ra vs. Claw Code: Two approaches to the agent harness

<span class="blog-date">April 1, 2026</span>

The [Claw Code](https://github.com/instructkr/claw-code) project made waves when it appeared on GitHub at the end of March — a clean-room rewrite of a leaked proprietary agent harness, first in Python and now being ported to Rust. It's an ambitious effort and worth studying. But it also raises a question that matters for anyone building autonomous agents: what does a purpose-built harness look like when you design it from scratch, versus when you reverse-engineer an existing one?

ra was built from the ground up as an open-source agent harness for autonomous execution. Claw Code was born from studying a proprietary system and reconstructing its patterns. The two projects share goals — give an LLM tools and let it loop — but their architectures diverge in ways that reveal different philosophies about control, composability, and where complexity should live.

This post is an honest comparison. We'll call out where ra is stronger, where Claw Code has ideas worth learning from, and where both projects have room to grow.

## Architecture: explicit loop vs. reconstructed runtime

ra's core is a 344-line `AgentLoop` class with a deliberately transparent lifecycle:

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → provider.stream() → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → tool.execute() → [afterToolExecution]
  → [afterLoopIteration]
  → repeat or [afterLoopComplete]
```

Every step is a named hook. Every hook receives typed context with `stop()`, `signal`, and a logger. You can block a tool call without stopping the loop (`deny(reason)`), modify the request before it reaches the model, or inspect stream chunks as they arrive. The loop is the product — not a detail buried inside a framework.

Claw Code's `ConversationRuntime` follows a similar pattern — stream events from an API client, extract tool calls, check permissions, execute, feed results back — but the loop itself is less exposed. The Rust implementation has pre/post-tool hooks, but they're wired through a `HookPipeline` struct rather than a composable middleware chain. The Python side is more of a routing scaffold: it matches prompts against a registry of mirrored commands and tools, simulates execution, and persists transcripts. It's not yet a live runtime.

**Where ra is stronger:** The middleware system is the single biggest architectural advantage. Nine hooks, composable via `mergeMiddleware()`, running sequentially with timeout isolation. You can layer observability middleware under base logic under history management without any of them knowing about each other. Claw Code's hooks are more tightly coupled to the runtime — you get pre/post-tool hooks, but you can't intercept the model call itself or observe individual stream chunks from middleware.

## Provider abstraction: unified interface vs. provider detection

ra implements a single `IProvider` interface with two methods — `chat()` and `stream()` — and ships seven implementations: Anthropic, OpenAI (both Responses and Completions APIs), Google, Ollama, AWS Bedrock, and Azure. Every provider maps to the same `StreamChunk` sequence: `text* → tool_call_start → tool_call_delta* → tool_call_end → done`. Switching providers is a config change.

```yaml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
```

Claw Code's Rust `ProviderClient` enum supports three backends — Claude, Grok (xAI), and OpenAI — with a `detect_provider_kind()` function that routes based on model name. It's clean for what it covers, but the enum-based approach means adding a provider requires modifying the core type. ra's trait-based approach lets you add a provider without touching existing code.

**Where ra is stronger:** Seven providers out of the box, each handling SDK-specific quirks (cache control hints for Anthropic, Responses vs. Completions for OpenAI, regional endpoints for Bedrock). The unified `StreamChunk` contract means middleware works identically across all providers — a `beforeModelCall` hook doesn't need to know whether it's talking to Claude or Gemini.

**Where Claw Code has an idea worth noting:** The model alias system (`"opus"` maps to `"claude-opus-4-6"`, `"grok"` maps to `"grok-3"`) is a nice ergonomic touch. ra has model resolution but could make short aliases more prominent.

## Context management: zone-aware compaction vs. token-estimated compression

This is where the architectural difference is sharpest. ra treats context as three zones:

- **Pinned** — system messages and the first user message. Never compacted.
- **Compactable** — the middle of the conversation. Eligible for truncation or summarization.
- **Recent** — the last 20% of the token budget. Always preserved.

When compaction triggers (at 90% of the context window, configurable), ra drops from the *back* of the compactable zone, preserving message prefixes for prompt caching. It never splits tool call groups — an assistant message stays with its tool calls and results. If a provider rejects the request anyway, ra parses the actual window size from the error, caches it, and retries with tighter compaction. This error-driven learning means ra adapts to undocumented context limits automatically.

Claw Code's compaction is simpler: estimate tokens as `len(text) / 4`, keep the last N messages (default 4), and summarize the rest into a structured note covering tools used, files referenced, and pending work. It works, but it doesn't account for provider-specific caching, doesn't preserve message grouping, and doesn't adapt to real context limits.

**Where ra is stronger:** Zone-aware compaction with cache-friendly ordering is a meaningful cost optimization. Over a long session with Anthropic, preserving the prompt prefix means cache hits on the system prompt and early context — which can cut input token costs significantly. The error-driven window learning is also something we haven't seen in other open-source harnesses.

## Tool system: registry with middleware vs. manifest with permissions

ra's tools are simple: a name, a description, a JSON Schema, and an `execute()` function. Eleven built-in tools cover filesystem operations, shell execution, and web fetching. Custom tools are TypeScript files loaded from config. MCP server tools register into the same `ToolRegistry` with prefixed names (`serverName__toolName`). Everything goes through `beforeToolExecution` and `afterToolExecution` hooks.

Tool output is truncated at 25KB with an intelligent split — 80% from the top, 20% from the bottom, with a clipping notice in between. This prevents a single large file read from blowing the context window while preserving both the beginning (usually the most relevant part) and the end (often containing the conclusion or error).

Claw Code's Rust tool system uses JSON schema inputs with explicit permission levels: `read-only`, `workspace-write`, and `danger-full-access`. Tools receive input via stdin and environment variables. The plugin system wraps tools in a manifest (`plugin.json`) that declares permissions, hooks, and lifecycle commands. The Python side is currently a shim layer — `execute_tool()` returns a message describing what *would* happen rather than actually executing.

**Where ra is stronger:** The middleware-based tool pipeline means you can implement cross-cutting concerns (logging, rate limiting, output sanitization) without modifying individual tools. The 25KB truncation with smart splitting is a practical detail that prevents context pollution from large tool outputs.

**Where Claw Code has an idea worth noting:** The three-tier permission model (`read-only` / `workspace-write` / `danger-full-access`) is more declarative than ra's regex-based rules. ra's permission system is more flexible — you can write regex rules per tool, per field — but Claw Code's approach is easier to reason about at a glance. There may be value in offering both: coarse-grained tool-level tiers for simple cases, fine-grained regex rules for precision.

## Plugin architecture: middleware vs. manifest-driven plugins

ra doesn't have a "plugin system" in the traditional sense. It has middleware (TypeScript files), skills (Markdown + scripts), and recipes (complete configs). These compose through layering: a recipe provides base middleware and skills, your config adds more, and they merge predictably. There's no plugin lifecycle, no installation registry, no version tracking — by design. The unit of extension is a file, not a package.

Claw Code's Rust implementation has a full plugin framework: `plugin.json` manifests declare capabilities, hooks, tools, and CLI commands. A `PluginManager` handles installation, enabling/disabling, updates, and uninstallation. Installed plugins are tracked in a registry with timestamps. Bundled plugins auto-sync from a directory. It's a proper package system.

**Where Claw Code is stronger:** If you're building a plugin ecosystem — where third parties publish extensions and users install them — Claw Code's manifest-based system is more robust. ra's file-based approach works well for project-local customization but doesn't have a story for versioned, distributable plugins.

**Where ra is stronger:** Simplicity. A middleware hook is a function in a file. A skill is a Markdown file with optional scripts. There's no manifest format to learn, no lifecycle to manage, no registry to maintain. For the common case — customizing an agent for your project — ra's approach has less ceremony.

## Testing: deterministic mocks vs. integration tests

ra's test suite (~2,850 lines) uses mock providers that return predetermined `StreamChunk` sequences. Tests are deterministic, offline, and fast. A `mockProvider()` utility lets you script multi-turn conversations. A `capturingProvider()` records what the loop sends. A `slowProvider()` introduces delays for testing abort behavior.

```typescript
const provider = mockProvider([[
  { type: 'text', delta: 'hello' },
  { type: 'tool_call_start', name: 'Read', id: '1' },
  { type: 'tool_call_end' },
  { type: 'done' }
]])
```

Claw Code's Rust tests include integration tests that exercise the API client against provider endpoints. The Python side has a single test file (`test_porting_workspace.py`) that verifies the workspace structure.

**Where ra is stronger:** Deterministic testing of agent behavior is essential for a system designed for autonomous execution. You need to verify that middleware fires in order, that tool calls are retried correctly, that compaction preserves the right messages, and that abort signals propagate cleanly — all without making real API calls. ra's mock infrastructure makes these tests reliable and fast.

## Maturity and readiness

ra is a working system today. You can `bun run ra "Fix the failing tests"` and it will stream model responses, execute tools, manage context, and loop until done. The CLI, REPL, HTTP API, MCP server, and cron interfaces all work. Seven providers are tested. The config system handles layered overrides with environment variable interpolation.

Claw Code is a work in progress. The Python workspace is primarily a porting scaffold — it mirrors the structure of the original system and can describe what it *would* do, but most "execution" is simulated. The Rust port is more substantial (real API clients, streaming, tool execution, a REPL), but the README itself notes it's "not yet a complete one-to-one replacement." Many directories in the Python source contain only `__init__.py` files — placeholders for subsystems that haven't been ported yet.

This isn't a knock on Claw Code. It's transparent about being early-stage. But if you need an agent harness you can deploy today, ra is ready and Claw Code is not.

## What ra can learn from Claw Code

Being honest about improvement opportunities:

1. **Rust-level performance.** Claw Code's bet on Rust is interesting for long-running agent sessions where memory efficiency and startup time matter. ra's core library is runtime-agnostic TypeScript — fast enough for most uses, but a native binary would be compelling for edge deployment and CI environments where cold start matters.

2. **Declarative permission tiers.** Claw Code's `read-only` / `workspace-write` / `danger-full-access` classification is immediately understandable. ra's regex-based permissions are more powerful but harder to audit. Adding a coarse permission tier as a complement to regex rules would improve the out-of-box experience.

3. **LSP integration.** Claw Code's Rust workspace includes an LSP client crate for editor integration. ra exposes itself as an MCP server (which editors like Cursor consume), but direct LSP integration could enable tighter IDE experiences — inline suggestions, diagnostics-aware tool calls, and richer context from the language server.

4. **Plugin distribution.** As the ecosystem grows, ra will need a story for versioned, installable plugins beyond "copy this file into your project." Claw Code's manifest + registry approach is one model worth studying.

## Summary

| Dimension | ra | Claw Code |
|---|---|---|
| **Core loop** | Explicit, 9 middleware hooks | Streaming loop with pre/post hooks |
| **Providers** | 7 (unified interface) | 3 (enum-based routing) |
| **Context mgmt** | Zone-aware, cache-friendly, error-adaptive | Token-estimated, fixed preserve count |
| **Tools** | Registry + middleware pipeline + MCP | Manifest + permission tiers |
| **Extensibility** | Middleware files, skills, recipes | Plugin manifests, lifecycle management |
| **Testing** | Deterministic mocks, ~2,850 lines | Integration tests, minimal Python tests |
| **Readiness** | Production-ready | Active development |
| **Language** | TypeScript (runtime-agnostic core) | Python scaffold + Rust port |

Both projects are trying to answer the same question: how do you build a reliable harness for autonomous LLM agents? ra's answer is transparency and composability — make every step visible, hookable, and configurable through files. Claw Code's answer is reconstruction and systems engineering — study what works in a proven system and rebuild it with better foundations.

If you're choosing a harness today for autonomous workloads, ra is the one that's ready. But keep an eye on Claw Code — the Rust port in particular has the potential to push the ecosystem forward on performance and plugin architecture.

---

*Try ra: [Getting started](/getting-started/quick-start) | [GitHub](https://github.com/chinmaymk/ra)*

<style>
.blog-date {
  display: inline-block;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-bottom: 1rem;
}
</style>

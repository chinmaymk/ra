# ra vs. claw-code: Two Approaches to Building an Agent Harness

<span class="blog-date">April 2, 2026</span>

When Anthropic's Claude Code source was leaked on March 31, 2026, it didn't take long for the reverse-engineering projects to appear. [claw-code](https://github.com/instructkr/claw-code) is the most ambitious of them — a cleanroom rewrite by Sigrid Jin that reconstructs Claude Code's architecture from scratch, with a Python workspace cataloging the full tool and command surface, and a Rust port implementing the actual runtime. The project hit 50K GitHub stars in two hours.

The leak made Claude Code's internals public knowledge. That means we can now have an honest, specific comparison between its architecture and ra's — not in the abstract, but subsystem by subsystem. This isn't a takedown. claw-code is serious systems work and the Rust runtime is genuinely well-built. But the two projects start from fundamentally different places, and those starting points lead to very different architectures. Understanding where each one excels reveals something useful about what makes an agent harness work well — especially for autonomous operation.

## Architecture at a glance

**ra** is a TypeScript library + CLI. The core library (`@chinmaymk/ra`) is runtime-agnostic — it runs on Node.js, Bun, or Deno. The CLI layer consumes the library and adds interfaces (REPL, HTTP, MCP server, cron). The agent loop is ~250 lines of explicit, hookable code.

**claw-code** is a dual-language project that mirrors Claude Code's architecture. The Python codebase (`src/`) catalogs the original's full surface — 150+ commands, 100+ tools, 28 subsystems — with reference snapshots and execution stubs. The Rust codebase (`rust/crates/`) is the real runtime: an API client, conversation loop, CLI, plugin infrastructure, MCP support, and built-in tools.

The structural difference is telling. ra was designed from scratch as a composable framework. claw-code reconstructs Claude Code's specific subsystems (hooks, plugins, skills, commands) faithfully rather than questioning whether those abstractions are the right ones. Its quality metric is parity with the original; ra's quality metric is how well the agent runs unattended.

### Quick comparison

| Dimension | ra | claw-code |
|---|---|---|
| **Language** | TypeScript (runtime-agnostic) | Rust + Python |
| **Providers** | 7 (Anthropic, OpenAI, Google, Ollama, Bedrock, Azure) | 3 (Anthropic, OpenAI-compat, xAI) |
| **Middleware hooks** | 9, in-process, typed contexts | Config-parsed, not yet executed at runtime |
| **Context compaction** | 3-zone, cache-aware, with summarization | Turn-count truncation, token-estimate compaction |
| **Sandboxing** | Permission middleware (application layer) | Linux namespace isolation (OS layer) |
| **Interfaces** | CLI, REPL, HTTP, MCP server, cron, inspector | REPL, prompt mode, HTTP/SSE server |
| **Skills** | Progressive disclosure, recipes, runtime creation | Local SKILL.md loading |
| **Autonomous controls** | Token budget, duration, adaptive thinking | max_iterations, usage tracking |
| **Built-in tools** | 13 | 20 |
| **Slash commands** | Interface-specific | 28 (including /ultraplan, /commit, /pr) |

## Where ra is stronger

### 1. The middleware system is a genuine extension point

ra has nine middleware hooks spanning the entire agent lifecycle:

```
beforeLoopBegin → beforeModelCall → onStreamChunk → afterModelResponse
→ beforeToolExecution → afterToolExecution → afterLoopIteration
→ afterLoopComplete → onError
```

Each hook receives a typed context object. `beforeModelCall` lets you mutate the messages and tools before they hit the provider. `beforeToolExecution` can deny a tool call without stopping the loop. Middleware is just TypeScript — no registration API, no plugin manifest:

```typescript
// Stop the agent if it's burned too many tokens
export default async function (ctx) {
  if (ctx.usage.inputTokens + ctx.usage.outputTokens > 500_000) {
    ctx.stop('Token budget exceeded')
  }
}
```

Claude Code has `PreToolUse`/`PostToolUse` hooks that can mutate, deny, or rewrite tool calls. claw-code parses this hook configuration from config files, but the Rust runtime doesn't actually execute them. The `PARITY.md` document is explicit: hooks are "config-only; runtime behavior missing." This means you can't programmatically control what the agent does mid-loop — a critical gap for autonomous operation where guardrails aren't optional.

ra's middleware, by contrast, is the load-bearing structure. It's not a feature bolted onto the loop — the loop *is* the middleware chain.

### 2. Provider-agnostic from the ground up

ra ships adapters for seven providers: Anthropic, OpenAI (both Responses and Completions APIs), Google Gemini, Ollama, AWS Bedrock, and Azure OpenAI. Each implements the same `IProvider` interface with `chat()` and `stream()` methods. Switching providers is a config change:

```yaml
agent:
  provider: google
  model: gemini-2.5-pro
```

This is where claw-code inherits Claude Code's biggest architectural constraint. Claude Code was built for one provider — Anthropic. claw-code adds OpenAI-compatible and xAI layers, but the message format, streaming protocol, and tool calling conventions are still shaped around Anthropic's API. Adding a truly different provider (say, Bedrock with its Converse API) would require significant plumbing changes. ra's message normalization layer handles this by design.

### 3. Context compaction that respects prompt caching

When conversations grow long, ra splits the message history into three zones: **pinned** (system prompt + first user message), **compactable** (middle messages), and **recent** (last N messages). Compaction truncates from the *back* of the compactable zone — this is a deliberate choice because Anthropic, OpenAI, and Google all cache prompt prefixes. Truncating from the front would destroy cache hits and significantly increase costs during long autonomous runs.

ra also supports a summarization strategy where a cheaper model condenses the compactable zone into a summary. The system automatically learns context window limits from provider errors and adjusts thresholds dynamically.

claw-code's Rust runtime has session compaction (`compact` command), and the Python port has a `compact_after_turns` mechanism. But neither implementation addresses prompt-cache-aware truncation. For autonomous agents that run for hundreds of iterations, this distinction in cost efficiency compounds quickly.

### 4. Designed for autonomous execution

ra's core loop was designed to run unattended. It supports:

- **`maxTokenBudget`** — hard cap on total tokens consumed before the loop stops
- **`maxDuration`** — wall-clock timeout for the entire run
- **`maxIterations`** — iteration cap (0 = unlimited, the default)
- **Adaptive thinking** — high thinking budget for the first 10 iterations (understanding the problem), then low for the rest (routine execution)
- **Parallel tool calls** — when the model returns multiple tool calls, they execute concurrently via `Promise.all`
- **Cron interface** — run agents on a schedule with isolated sessions
- **Abort signals** — external cancellation that propagates cleanly through middleware

claw-code's Rust runtime supports `max_iterations` (set to `usize::MAX` by default) and basic usage tracking. But it lacks the budget/duration/thinking controls that make autonomous runs predictable and safe. When you're running an agent overnight on a codebase, you need to know it won't silently burn $200 in tokens or spin indefinitely on a stuck tool call.

### 5. Recipes and composable skills

ra's recipe system packages complete agent configurations — config, skills, and middleware — as directories:

```bash
ra --recipe coding-agent "Fix the failing tests and open a PR"
ra --recipe karpathy-autoresearch "Survey recent papers on test-time compute"
```

Skills use progressive disclosure: the model initially sees only names and one-line descriptions, loading full instructions only when a skill is activated. This keeps the context lean. Skills can be installed from GitHub, npm, or local directories, and the agent can write new skills at runtime.

claw-code has a `Skill` tool in Rust that reads local `SKILL.md` files, and the Python port has a skills module. But there's no bundled skill registry, no progressive disclosure, no skill composition, and no recipe system. The `PARITY.md` calls this out: "basic local skill loading only."

### 6. Multiple interfaces from a single binary

ra runs as:
- **CLI** — one-shot prompts, piping (`cat error.log | ra "explain"`), chaining
- **REPL** — interactive sessions with history, slash commands, attachments
- **HTTP API** — sync and streaming endpoints
- **MCP server** — expose the agent to Cursor, Claude Desktop, etc.
- **Cron** — scheduled autonomous jobs
- **Inspector** — web dashboard showing every model call, tool execution, and token spend

claw-code's Rust CLI supports REPL and prompt modes. It doesn't have HTTP, MCP server, or cron interfaces. For teams that want to embed an agent into existing workflows (CI/CD, internal tools, editor integrations), the interface breadth matters.

## Where claw-code is interesting

### Systems-language runtime

claw-code's Rust implementation brings genuine advantages for certain deployment scenarios. Native binaries start faster, use less memory, and don't carry a runtime. For edge deployments or resource-constrained environments, this matters. ra's TypeScript core is lightweight but still requires a JavaScript runtime.

### Sandbox isolation

This is arguably claw-code's most impressive subsystem. The Rust runtime uses Linux `unshare` to create isolated namespaces — user, mount, IPC, PID, UTS, and optionally network — before executing tools. Three filesystem modes (off, workspace-only, allow-list) let you control exactly what the agent can touch. It detects container environments (Docker, Kubernetes, Podman) and adjusts accordingly.

For autonomous agents executing arbitrary shell commands, process-level sandboxing isn't a nice-to-have — it's a safety boundary. ra relies on permission middleware to deny dangerous operations, which works but operates at a higher level of abstraction. A misbehaving tool that bypasses the middleware layer has no further guardrail. claw-code's approach isolates at the OS level, which is fundamentally harder to escape.

### A serious Rust runtime

The Rust port deserves more credit than "it's a reverse-engineering project." The `ConversationRuntime<C, T>` is generic over API client and tool executor traits — clean, testable, and provider-swappable. There are 20 built-in tools, 28 slash commands (including `/ultraplan` for multi-step execution plans, `/commit`, `/pr`, and `/teleport` for ripgrep-powered code navigation), sub-agent types (Explore, Plan, Verification) with isolated tool sets, and per-model cost tracking with cache-aware pricing. This is a functional coding agent, not a prototype.

### Exhaustive surface mapping

The Python codebase is a remarkably thorough catalog of what an agent CLI needs. The `reference_data/` directory contains JSON snapshots of 28+ subsystems, 150+ commands, and 100+ tools. If you're building an agent harness and wondering "what tools do I need?", claw-code's inventory is genuinely useful as a reference — it's one of the most complete public maps of an agent CLI's surface area.

### Permission model baked into the runtime

claw-code's Rust runtime has permissions integrated directly into the conversation loop — three hierarchical modes (ReadOnly, WorkspaceWrite, DangerFullAccess) with interactive escalation prompts when a tool needs more access than the current mode allows. ra handles permissions through middleware (which is more flexible) but claw-code's approach of making permissions a first-class runtime concept with explicit escalation is a defensible design choice for security-critical deployments.

## Opportunities for ra to improve

### Process-level sandboxing

This is the biggest gap. ra's permission middleware can deny tool calls based on regex patterns, but it operates at the application layer. If an agent runs `bash -c "curl ... | sh"` and the permission rules don't catch the pattern, there's no fallback. claw-code's namespace isolation provides defense in depth — even if a tool call slips through policy, the process can't reach the network or filesystem outside the sandbox. Adding opt-in sandboxing (Linux namespaces, macOS sandbox-exec, or container-based isolation) would make ra's autonomous story significantly more credible for production deployments.

### Rust/native compilation option

For deployment scenarios where startup time and memory footprint matter (serverless, edge, embedded), a native compilation path would be valuable. This doesn't mean rewriting ra in Rust — but providing an option for ahead-of-time compilation (perhaps via Bun's compile target, which ra already uses for its binary distribution) is worth pushing further.

### More structured permission DSL

ra's regex-based permission rules are powerful but can be hard to audit at scale. A more structured permission model — with explicit capability declarations per tool, hierarchical policies, and a dry-run mode that shows what would be allowed/denied — would make ra easier to trust in enterprise environments.

### Plugin ecosystem

claw-code's plugin architecture (even if not yet functional in Rust) points to a real need: the ability to install, enable, and manage third-party extensions as discrete packages rather than as loose middleware files and skill directories. ra's middleware and skill systems are more capable, but packaging them into installable, versioned plugins with a registry would lower the barrier for community contributions.

### LSP integration

claw-code has a full LSP client crate (`rust/crates/lsp/`) with diagnostics, symbol navigation, and context enrichment. This points to a real opportunity. Language Server Protocol integration would give agents access to type information, go-to-definition, find-references, and compiler diagnostics — significantly improving code understanding without burning tokens on grep-based exploration.

## The deeper difference

The fundamental divergence isn't about features or language choices. It's about design philosophy.

The Claude Code leak gave the community a detailed look at how Anthropic builds agent infrastructure. claw-code faithfully reconstructs that architecture — and in doing so, inherits both its strengths (sandboxing, comprehensive tooling, battle-tested patterns) and its constraints (single-provider assumptions, hooks that exist in config but not in runtime, no compositional skill system).

ra starts from a different question: *what does an agent harness need to be if it's going to run autonomously?* The answer is: explicit control at every step (middleware), predictable resource consumption (budgets, timeouts, adaptive thinking), composable behavior (skills, recipes), and operational visibility (structured logging, inspector, traces). These aren't features bolted on after the fact — they're the load-bearing walls.

The Claude Code source being public is actually good for the ecosystem. It validates patterns that independent frameworks like ra arrived at independently (the stream-collect-execute loop, context compaction, skill-based instruction injection) and exposes gaps that everyone should learn from (process-level sandboxing, LSP integration). Both projects prove that the agent harness is becoming well-understood infrastructure. claw-code maps Claude Code's surface comprehensively and gets sandboxing right. ra explores how deep the control surface needs to go and gets the autonomous loop right. The ideal agent harness probably looks like ra's middleware and compaction with claw-code's isolation model.

If you're building agents that need to run unattended, ship to production, and stay within guardrails, [take ra for a spin](https://github.com/chinmaymk/ra).

<style>
.blog-date {
  display: inline-block;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-bottom: 1rem;
}
</style>

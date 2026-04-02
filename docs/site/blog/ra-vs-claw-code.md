# ra vs. claw-code: Two Approaches to Building an Agent Harness

<span class="blog-date">April 2, 2026</span>

[claw-code](https://github.com/instructkr/claw-code) recently appeared on GitHub — a cleanroom reverse-engineering effort that attempts to reconstruct the architecture of a well-known commercial agent CLI. It has a Python implementation for modeling the tool and command surfaces, plus an active Rust port for the actual runtime. The project has gotten attention (50K stars in two hours, if the README is to be believed), so it's worth examining how its design choices compare to ra's.

This isn't a takedown. claw-code is an impressive reverse-engineering effort and the Rust runtime is a serious piece of systems work. But the two projects have fundamentally different goals, and those goals lead to very different architectures. Understanding where each one excels reveals something useful about what makes an agent harness work well in practice — especially for autonomous operation.

## Architecture at a glance

**ra** is a TypeScript library + CLI. The core library (`@chinmaymk/ra`) is runtime-agnostic — it runs on Node.js, Bun, or Deno. The CLI layer consumes the library and adds interfaces (REPL, HTTP, MCP server, cron). The agent loop is ~250 lines of explicit, hookable code.

**claw-code** is a dual-language project. The Python codebase (`src/`) catalogs and mirrors the tool and command surfaces of its target — it's essentially a porting workspace with reference snapshots, backlog tracking, and execution stubs. The Rust codebase (`rust/crates/`) is the real runtime: an API client, conversation loop, CLI, plugin infrastructure, MCP support, and built-in tools.

The structural difference is telling. ra was designed from scratch as a composable framework. claw-code was reverse-engineered from a specific product, and its architecture reflects that origin — it faithfully reconstructs subsystems (hooks, plugins, skills, commands) rather than questioning whether those abstractions are the right ones.

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

claw-code parses hook configuration from config files, but the Rust runtime doesn't actually execute hooks at runtime. The `PARITY.md` document is explicit: hooks are "config-only; runtime behavior missing." There's no `PreToolUse`/`PostToolUse` mutation, deny, or rewrite pipeline. This means you can't programmatically control what the agent does mid-loop — a critical gap for autonomous operation where guardrails aren't optional.

### 2. Provider-agnostic from the ground up

ra ships adapters for seven providers: Anthropic, OpenAI (both Responses and Completions APIs), Google Gemini, Ollama, AWS Bedrock, and Azure OpenAI. Each implements the same `IProvider` interface with `chat()` and `stream()` methods. Switching providers is a config change:

```yaml
agent:
  provider: google
  model: gemini-2.5-pro
```

claw-code's Rust runtime has a core Anthropic API client and an OpenAI-compatible provider layer. But the architecture is built around one vendor's message format and streaming protocol. Adding a truly different provider (say, Bedrock with its Converse API) would require significant plumbing changes. ra's message normalization layer handles this by design.

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

### Exhaustive surface mapping

The Python codebase is a remarkably thorough catalog of what an agent CLI needs. The `reference_data/` directory contains JSON snapshots of 28+ subsystems, every tool, every command. If you're building an agent harness and wondering "what tools do I need?", claw-code's inventory is genuinely useful as a reference — it's one of the most complete public maps of an agent CLI's surface area.

### Permission model baked into the runtime

claw-code's Rust runtime has permissions integrated directly into the conversation loop, with tool-level deny logic that runs during execution. ra handles permissions through middleware (which is more flexible) but claw-code's approach of making permissions a first-class runtime concept rather than an optional middleware is a defensible design choice for security-critical deployments.

## Opportunities for ra to improve

### Rust/native compilation option

For deployment scenarios where startup time and memory footprint matter (serverless, edge, embedded), a native compilation path would be valuable. This doesn't mean rewriting ra in Rust — but providing an option for ahead-of-time compilation (perhaps via Bun's compile target, which ra already uses for its binary distribution) is worth pushing further.

### More structured permission DSL

ra's regex-based permission rules are powerful but can be hard to audit at scale. A more structured permission model — with explicit capability declarations per tool, hierarchical policies, and a dry-run mode that shows what would be allowed/denied — would make ra easier to trust in enterprise environments.

### Plugin ecosystem

claw-code's plugin architecture (even if not yet functional in Rust) points to a real need: the ability to install, enable, and manage third-party extensions as discrete packages rather than as loose middleware files and skill directories. ra's middleware and skill systems are more capable, but packaging them into installable, versioned plugins with a registry would lower the barrier for community contributions.

### LSP integration

claw-code maps an `LSPTool` in its tool surface, pointing to a real opportunity. Language Server Protocol integration would give agents access to type information, go-to-definition, find-references, and diagnostics — significantly improving code understanding without burning tokens on grep-based exploration.

## The deeper difference

The fundamental divergence isn't about features or language choices. It's about design philosophy.

claw-code is reconstructing a known system. Its quality metric is parity — how closely does it match the original? This produces a faithful reproduction but inherits the original's architectural decisions, including ones that may not be optimal.

ra starts from a different question: *what does an agent harness need to be if it's going to run autonomously?* The answer is: explicit control at every step (middleware), predictable resource consumption (budgets, timeouts, adaptive thinking), composable behavior (skills, recipes), and operational visibility (structured logging, inspector, traces). These aren't features bolted on after the fact — they're the load-bearing walls.

Both projects prove that the agent harness is becoming a well-understood piece of infrastructure. The interesting question isn't which one is "better" — it's what each one reveals about the design space. claw-code maps the surface area comprehensively. ra explores how deep the control surface needs to go.

If you're building agents that need to run unattended, ship to production, and stay within guardrails, [take ra for a spin](https://github.com/chinmaymk/ra).

<style>
.blog-date {
  display: inline-block;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-bottom: 1rem;
}
</style>

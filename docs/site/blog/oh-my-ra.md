# oh-my-ra: Your Agent, Your Rules

<span class="blog-date">April 6, 2026</span>

Projects like [oh-my-claude](https://github.com/TechDufus/oh-my-claude) and [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) showed that coding agents get dramatically better when you layer on structured workflows — quality gates that catch bugs before you see them, research skills that parallelize investigation, loop detection that breaks circular debugging. But these projects bolt onto existing CLIs through prompt injection, hooks files, and CLAUDE.md conventions. They're clever workarounds for platforms that weren't designed to be extended this deeply.

ra was designed for exactly this. Middleware hooks span every phase of the agent loop. Skills are first-class. Custom tools are just TypeScript factories. So we built **oh-my-ra** — a complete recipe that brings the best ideas from the "oh-my" ecosystem into ra natively. No workarounds, no prompt injection, no fragile hooks. Just config, skills, middleware, and tools.

## What's in the box

oh-my-ra ships 16 skills, 8 middleware hooks, 2 custom tools, 3 auto-run scripts, and an OWASP reference document. Here's how they fit together.

### The skill system

Skills are activated by the user (`/debugger`) or suggested automatically by middleware when the agent detects matching patterns in your message. Each skill is a markdown file with structured instructions that get injected into the agent's system prompt on activation. Some skills have `scripts/` directories that auto-run on activation to gather context, and `references/` directories with supplementary material.

oh-my-ra organizes its 16 skills into three categories:

**Workflow skills** control how the agent approaches a task:

| Skill | What it does |
|-------|-------------|
| `/ultrawork` | Full autonomous pipeline: clarify → plan → execute → verify → self-review |
| `/interview` | Socratic clarification — max 5 questions with defaults before acting |
| `/deep-research` | Parallel multi-agent investigation with synthesized findings |
| `/team` | Parallel specialist coordination — dispatch 2-4 focused agents |
| `/pair` | Interactive pair programming — narrate reasoning, check in at decisions |

**Engineering skills** provide structured methodologies:

| Skill | What it does |
|-------|-------------|
| `/debugger` | 7-step systematic debugging with auto-gathered git context |
| `/architect` | System design — propose 2-3 approaches with trade-off analysis |
| `/refactor` | Incremental restructuring with green-to-green verification |
| `/test-writer` | Discover test framework, plan cases, write comprehensive tests |
| `/explain` | Deep code walkthrough — trace data flow and design decisions |
| `/migrate` | Phased migration with rollback points at every step |

**Quality & delivery skills** ensure work ships clean:

| Skill | What it does |
|-------|-------------|
| `/critic` | Quality review — correctness, security, edge cases, maintainability |
| `/security-audit` | OWASP Top 10 checklist with auto-discovered attack surface |
| `/commit` | Pre-commit checks, staged diff review, conventional commits |
| `/pr` | Full PR workflow — checks, description, reviewer notes |
| `/stuck` | Loop recovery — challenge assumptions, reframe, try new angle |

### The middleware layer

This is where oh-my-ra diverges most from the "oh-my" projects that inspired it. Instead of injecting behavior through prompt engineering, oh-my-ra uses ra's native middleware hooks to intercept, inspect, and modify the agent loop at every phase:

```
User message
  → [repo-context] injects git branch, commits, uncommitted changes
  → [auto-skill] detects patterns, suggests /debugger for "this is broken"
  → [context-guard] warns at 70% context usage, alerts at 85%
  → Model generates response
  → [token-budget] stops the loop if hard budget exceeded
  → [quality-gate] blocks rm -rf, secret file writes, credential leaks
  → Tools execute
  → [progress-tracker] logs iteration stats to stderr
  → [loop-guard] detects repeated errors, suggests /stuck
  → Repeat until done
  → [session-summary] prints final stats
```

Each middleware is a standalone TypeScript file with a single default export. No registration, no plugin API. Here's the complete quality gate that blocks destructive operations:

```typescript
// middleware/quality-gate.ts
import type { ToolExecutionContext } from "@chinmaymk/ra"

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf?\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bdrop\s+table\b/i,
  // ... more patterns
]

export default async function qualityGate(ctx: ToolExecutionContext) {
  const input = JSON.parse(ctx.toolCall.arguments || "{}")

  if (ctx.toolCall.name === "Bash" && input.command) {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(input.command)) {
        ctx.deny(`Blocked destructive command. Ask the user first.`)
        return
      }
    }
  }
}
```

The `ctx.deny()` call blocks the tool execution and returns an error to the model — but doesn't stop the loop. The agent learns the command was blocked and adjusts. This is a native ra concept that the "oh-my" projects can't replicate through prompt injection alone.

### Custom tools

Two custom tools extend the agent's capabilities beyond the built-in filesystem and shell tools:

**ProjectScan** discovers a project's structure, tech stack, frameworks, test runner, package manager, available scripts, and convention files (`CLAUDE.md`, `.editorconfig`, `biome.json`, etc.) in a single call. The agent runs this when entering an unfamiliar codebase instead of spending several iterations on manual discovery.

**DependencyCheck** audits dependencies for known vulnerabilities, outdated packages, and license issues. It supports npm, pip, and cargo — detecting the ecosystem from the project's manifest files.

Both are TypeScript factory functions that return an `ITool` object:

```typescript
export default function projectScanTool(): ITool {
  return {
    name: "ProjectScan",
    description: "Scans the project to discover its structure...",
    inputSchema: { /* ... */ },
    async execute(input) { /* ... */ }
  }
}
```

Registered in config with one line:

```yaml
tools:
  custom:
    - ./tools/project-scan.ts
    - ./tools/dep-check.ts
```

### Skill scripts and references

Three skills include `scripts/` directories with shell scripts that auto-run when the skill is activated:

- **`/security-audit`** runs `discover.sh` — finds HTTP endpoints, auth code, database queries, and hardcoded secrets before the agent starts its review
- **`/debugger`** runs `context.sh` — gathers recent git changes, test file locations, and uncommitted state
- **`/commit`** runs `pre-check.sh` — shows staged/unstaged diffs and checks for debug artifacts and merge conflict markers

The `/security-audit` skill also includes `references/owasp-quick-ref.md` — a condensed OWASP Top 10 cheatsheet that's available as context during the audit.

## Why native beats bolted-on

The "oh-my" projects are impressive engineering within tight constraints. But building on ra's native primitives gives us real advantages:

**Type-safe middleware.** Every middleware function receives a typed context (`ToolExecutionContext`, `ModelCallContext`, `LoopContext`) with the exact fields available at that point in the lifecycle. The quality gate can call `ctx.deny()` — a concept that doesn't exist in prompt-injected systems.

**Composable hooks.** Middleware runs in array order. You can reorder, remove, or add hooks in the config without touching code. The auto-skill middleware runs before the model call; the quality gate runs before tool execution. They don't know about each other and don't need to.

**Real tool registration.** Custom tools like ProjectScan appear in the model's tool list with proper JSON Schema descriptions. The model can call them with structured arguments. No "magic keywords" in the system prompt — just tools.

**Script execution.** Skill scripts run real shell commands and inject their output as context. The security audit's `discover.sh` actually greps the codebase — it doesn't ask the model to grep the codebase.

**Context compaction.** When the context window fills up (which the context-guard middleware monitors), ra's compaction system summarizes the conversation. oh-my-ra's custom compaction prompt preserves plans, research findings, and git state across compaction boundaries — something prompt-injected systems lose entirely.

## Getting started

```bash
# Clone ra and run oh-my-ra
git clone https://github.com/chinmaymk/ra
cd ra
bun install
bun run ra --config recipes/oh-my-ra/ra.config.yaml
```

Override the provider or model:

```bash
PROVIDER=openai MODEL=gpt-4o bun run ra --config recipes/oh-my-ra/ra.config.yaml
```

Set a token budget:

```bash
RA_TOKEN_BUDGET=500000 bun run ra --config recipes/oh-my-ra/ra.config.yaml
```

## Extending it

oh-my-ra is a recipe — a directory of config, skills, middleware, and tools. Everything is a file you can read, modify, or delete.

**Add a skill:** Create `skills/my-skill/SKILL.md` with YAML frontmatter (`name`, `description`) and markdown instructions.

**Add middleware:** Write a TypeScript file with a default async export, add the path to the relevant hook in `ra.config.yaml`.

**Add a tool:** Write a TypeScript factory function returning `{ name, description, inputSchema, execute }`, add the path to `tools.custom` in `ra.config.yaml`.

**Remove something:** Delete the file and remove its reference from the config. No cascading breakage.

The recipe is yours. Fork it, strip it down, build it up. Your agent, your rules.

<style>
.blog-date {
  display: inline-block;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-bottom: 1rem;
}
</style>

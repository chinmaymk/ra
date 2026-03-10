# Coding Agent

A general-purpose coding agent built with ra. Reads, writes, debugs, and navigates codebases interactively — similar to Claude Code or Cursor CLI.

## Prerequisites

- [ra](../../README.md) installed
- `ANTHROPIC_API_KEY` environment variable set

## Quick Start

```bash
# Copy the recipe into your project
cp -r recipes/coding-agent /path/to/your/project/.ra

# Or use it directly
cd recipes/coding-agent
ra

# One-shot mode
ra --interface cli "add error handling to src/server.ts"
```

## What Makes This a Top-Tier Coding Agent

### Structured Workflow
Every task follows **Explore → Plan → Implement → Verify**. The agent reads code before editing, plans complex work before starting, and verifies changes actually work before declaring success.

### Project Auto-Discovery
The `project-discovery` middleware runs at startup and automatically detects:
- Project type (Node.js, Rust, Python, Go, Java, Ruby, etc.)
- Package manager (bun, npm, pnpm, yarn)
- Test, build, lint, and type-check commands from `package.json` scripts or language defaults
- Convention files (`CLAUDE.md`, `.cursorrules`, `CONVENTIONS.md`)

This context is injected into the system prompt so the agent knows how to build and test your project from the first message.

### Automatic Syntax Verification
The `auto-verify` middleware runs a quick syntax check after every file write. If you introduce a syntax error in a `.ts`, `.js`, `.py`, or `.json` file, the agent sees it immediately and self-corrects — no wasted iterations.

### Self-Review Checkpoints
The `self-review` middleware periodically reminds the agent to step back and verify progress. This prevents "tunnel vision" where the agent makes many changes without checking if they actually work.

### Error Diagnosis Protocol
Structured approach to debugging: read the full error, locate the failure point, form a hypothesis, test it, fix the root cause. No random trial-and-error.

## Capabilities

- **File operations** — Read, write, edit, search, glob
- **Shell execution** — Run builds, tests, git commands, any CLI tool
- **Codebase navigation** — Find definitions, references, implementations, related tests, change history
- **Multi-turn conversation** — REPL with session persistence and resumption
- **Subagent parallelization** — Spawn subagents for independent read-only tasks
- **Safety** — Asks for confirmation before destructive operations
- **Context compaction** — Handles long sessions by summarizing older messages

## Available Skills

The `coding-agent` skill is always active. These specialist skills are available on-demand:

- `debugger` — Systematic bug diagnosis
- `planner` — Break work into concrete steps
- `architect` — System design and trade-offs
- `code-style` — Enforce coding standards
- `code-review` — Review changes for bugs, security, and correctness
- `test-runner` — Find, run, and interpret tests; write new tests
- `writer` — Write documentation

## Middleware

| Middleware | Hook | Purpose |
|-----------|------|---------|
| `project-discovery` | `beforeLoopBegin` | Auto-detect project type, commands, and conventions |
| `auto-verify` | `afterToolExecution` | Syntax check after file writes |
| `self-review` | `afterLoopIteration` | Periodic progress checkpoint |

## Customization

### Model

```yaml
provider: anthropic
model: claude-sonnet-4-6  # cheaper, still capable
```

### Iterations

```yaml
maxIterations: 200  # increase for very complex tasks
```

### Self-Review Frequency

Set the `RA_REVIEW_INTERVAL` environment variable (default: 15 iterations):
```bash
RA_REVIEW_INTERVAL=10 ra
```

### Add MCP Servers

```yaml
mcp:
  client:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
```

## How It Works

1. **Config** (`ra.config.yaml`) — Sets up Opus with high thinking, REPL interface, 200 iteration limit, and three middleware hooks
2. **Project Discovery** — At startup, detects project type and injects context (commands, conventions)
3. **Skill** (`skills/coding-agent/SKILL.md`) — Defines the Explore → Plan → Implement → Verify workflow
4. **Auto-Verify** — After every file write, runs a syntax check and feeds errors back immediately
5. **Self-Review** — Every 15 iterations, reminds the agent to verify progress
6. **Built-in tools** — Filesystem ops, bash, search, glob, web fetch, ask_user, checklist, subagent
7. **Compaction** — Summarizes old messages when context reaches 80% capacity

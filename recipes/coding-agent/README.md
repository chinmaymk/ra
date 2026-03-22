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

## Capabilities

- **File operations** — Read, write, edit, search, glob
- **Shell execution** — Run builds, tests, git commands, any CLI tool
- **Codebase navigation** — LSP-like patterns for finding definitions, references, type errors
- **Multi-turn conversation** — REPL with session persistence and resumption
- **Safety** — Asks for confirmation before destructive operations
- **Context compaction** — Handles long sessions by summarizing older messages

## Available Skills

The `coding-agent` skill is always active. These specialist skills are available on-demand (the model can request them):

- `debugger` — Systematic bug diagnosis
- `planner` — Break work into concrete steps
- `architect` — System design and trade-offs
- `code-style` — Enforce coding standards
- `writer` — Write documentation

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

### Add MCP servers

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

1. **Config** (`ra.config.yaml`) — Sets up Opus with high thinking, REPL interface, 200 iteration limit
2. **Skill** (`skills/coding-agent/SKILL.md`) — Defines coding agent behavior: file editing discipline, codebase navigation patterns, safety rules, testing workflow
3. **Built-in tools** — Filesystem ops, bash, search, glob, web fetch, checklist
4. **Compaction** — Summarizes old messages when context reaches 80% capacity

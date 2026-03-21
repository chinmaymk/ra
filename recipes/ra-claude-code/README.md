# ra-claude-code

A coding agent recipe that replicates Claude Code's context engineering and safety-first behavior using ra. Interactive REPL with extended thinking, automatic context discovery, and careful execution principles.

## What It Does

- **Context engineering:** Discovers and follows project instructions (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`), detects project environment (language, package manager, scripts), and respects context hierarchy
- **Safety-first execution:** Confirms before destructive operations, never skips git hooks, stages files explicitly, creates new commits instead of amending
- **Claude Code system prompt principles:** Read before write, minimal changes, avoid over-engineering, no premature abstractions, security-first coding
- **Full tool access:** Filesystem (Read/Write/Edit/Glob/Grep), shell (Bash), web fetch, user interaction, checklist tracking
- **Extended thinking:** Opus with high thinking budget for complex reasoning
- **Auto-compaction:** Summarizes older context at 80% threshold to stay within limits
- **Token budget:** Configurable hard stop to prevent runaway sessions

## Skills

| Skill | Purpose |
|-------|---------|
| `claude-code-agent` | Core coding agent — editing, navigation, testing, output style |
| `context-engineer` | Project context discovery and convention matching |
| `planner` | Task decomposition for complex multi-step work |
| `debugger` | Systematic bug diagnosis: reproduce → isolate → fix → verify |
| `git-workflow` | Safe git operations: commits, PRs, conflict resolution |
| `code-style` | Code quality: correctness, security, simplicity, readability |

## Prerequisites

- [ra](https://github.com/chinmaymk/ra) installed
- `ANTHROPIC_API_KEY` environment variable set
- Optional: `GITHUB_TOKEN` for GitHub MCP integration

## Quick Start

```bash
# Interactive REPL (default)
ra --config recipes/ra-claude-code/ra.config.yaml

# One-shot CLI mode
ra --config recipes/ra-claude-code/ra.config.yaml --interface cli "fix the failing tests"

# With custom token budget (default: 800k)
RA_TOKEN_BUDGET=500000 ra --config recipes/ra-claude-code/ra.config.yaml
```

## Customization

### Change model
Edit `ra.config.yaml`:
```yaml
agent:
  model: claude-sonnet-4-6     # faster, cheaper
  thinking: medium              # or remove for no thinking
```

### Add GitHub MCP server
Uncomment the `mcp` section in `ra.config.yaml` and set `GITHUB_TOKEN`.

### Adjust iterations
```yaml
agent:
  maxIterations: 100   # default 200, reduce for bounded tasks
```

### Token budget
```bash
export RA_TOKEN_BUDGET=1000000  # default 800k tokens
```

## How It Works

1. **Config** sets up Opus with high thinking, REPL interface, 200 max iterations
2. **claude-code-agent** skill defines core behavior: read-before-write, minimal changes, safety rules, tool usage, output style — modeled after Claude Code's system prompts
3. **context-engineer** skill discovers project context files and conventions at session start
4. **Environment detection script** runs at activation to inject platform, git, and project info
5. **Supporting skills** (planner, debugger, git-workflow, code-style) provide specialized workflows
6. **Token budget middleware** enforces a hard stop when token usage exceeds the limit
7. **Compaction** auto-summarizes old messages at 80% context threshold

## Prompt Architecture

Inspired by [Claude Code's system prompts](https://github.com/Piebald-AI/claude-code-system-prompts), this recipe distills 110+ conditional prompt components into 6 focused skills:

- **Execution care** — reversibility checks, blast radius assessment, user confirmation for destructive ops
- **Over-engineering prevention** — no premature abstractions, no unnecessary additions, minimal changes
- **Tool usage discipline** — dedicated tools over bash alternatives, parallel calls when independent
- **Git safety** — new commits over amends, explicit staging, no hook skipping, no force push
- **Output efficiency** — concise, action-first, no filler, file:line references

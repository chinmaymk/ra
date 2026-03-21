# ra-claude-code

A coding agent recipe that replicates Claude Code's context engineering and safety-first behavior using ra. Interactive REPL with extended thinking, automatic context discovery, and careful execution principles.

## What It Does

- **Autonomous execution:** Executes immediately with reasonable assumptions, only asks when genuinely blocked or action is destructive
- **Context engineering:** Discovers and injects project instructions (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`) at session start, detects environment (language, package manager, scripts), respects context hierarchy
- **Safety-first execution:** Confirms before destructive operations, never skips git hooks, stages files explicitly, creates new commits instead of amending
- **Verification loop:** Runs tests, type-checks, and lints after changes — never claims completion without evidence
- **Claude Code system prompt principles:** Read before write, minimal changes, avoid over-engineering, no premature abstractions, security-first coding
- **Full tool access:** Filesystem (Read/Write/Edit/Glob/Grep), shell (Bash), web fetch, user interaction, checklist tracking
- **Subagent delegation:** Spawns focused exploration agents for broad codebase search, parallelizes independent research
- **Stuck recovery:** Detects repeated failures and forces strategy changes instead of looping
- **Smart compaction:** Custom summarization prompt preserves file paths, decisions, git state, and task progress when context is compressed
- **Session memory:** Persists knowledge across sessions
- **Extended thinking:** Opus with high thinking budget for complex reasoning
- **Token budget:** Configurable hard stop (800k default) to prevent runaway sessions

## Skills

| Skill | Purpose |
|-------|---------|
| `claude-code-agent` | Core coding agent — editing, navigation, tool usage, output style, safety rules |
| `auto-mode` | Autonomous execution — do, don't ask. Only confirm for destructive/visible actions |
| `context-engineer` | Project context discovery — CLAUDE.md, AGENTS.md, .cursorrules injection + hierarchy |
| `planner` | Task decomposition for complex multi-step work (5-8 steps, front-load risk) |
| `debugger` | Systematic bug diagnosis: reproduce → isolate → hypothesize → fix → verify |
| `verify` | Post-change verification: type-check → lint → test → build. Fix failures immediately |
| `git-workflow` | Git safety protocol: never force push, never skip hooks, explicit staging |
| `quick-commit` | Streamlined commit: parallel assess, draft message, stage by name, HEREDOC format |
| `quick-pr` | PR creation: analyze all branch commits, title <70 chars, push + `gh pr create` |
| `code-style` | Code quality: correctness → security → simplicity → readability |
| `explore-delegate` | Subagent patterns: when/how to spawn exploration, planning, and parallel agents |
| `stuck-recovery` | Self-diagnosis: detect loops, challenge assumptions, force strategy changes |

## Activation Scripts

| Script | Skill | Purpose |
|--------|-------|---------|
| `detect-environment.ts` | `claude-code-agent` | Injects platform, git branch, project type, package manager, available scripts |
| `discover-context.ts` | `context-engineer` | Walks cwd → git root, finds and injects CLAUDE.md/AGENTS.md/.cursorrules content |

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

### Disable memory
```yaml
agent:
  memory:
    enabled: false
```

## How It Works

1. **Config** sets up Opus with high thinking, REPL interface, 200 max iterations, memory enabled
2. **auto-mode** skill tells the agent to execute immediately — no unnecessary questions
3. **context-engineer** skill + `discover-context.ts` script find and inject all project instruction files (CLAUDE.md etc.) at session start
4. **claude-code-agent** skill + `detect-environment.ts` script define core behavior and inject platform/project context
5. **verify** skill ensures the agent runs tests, type-checks, and lints after every change
6. **quick-commit** and **quick-pr** skills provide Claude Code's exact git protocols (parallel assess, HEREDOC messages, stage-by-name)
7. **explore-delegate** skill teaches when/how to spawn focused subagents for codebase exploration
8. **stuck-recovery** skill detects repeated failures and forces strategy pivots
9. **Custom compaction prompt** preserves file paths, decisions, git state, and task progress when context is compressed
10. **Token budget middleware** enforces a configurable hard stop (800k default)

## Prompt Architecture

Inspired by [Claude Code's system prompts](https://github.com/Piebald-AI/claude-code-system-prompts), this recipe distills 110+ conditional prompt components into 12 focused skills:

- **Autonomous execution** — do immediately, ask only when genuinely blocked or destructive
- **Context engineering** — discover, inject, and respect project instruction hierarchy
- **Execution care** — reversibility checks, blast radius assessment, user confirmation for destructive ops
- **Over-engineering prevention** — no premature abstractions, no unnecessary additions, minimal changes
- **Verification discipline** — type-check, lint, test after every change; fix failures before reporting
- **Tool usage discipline** — dedicated tools over bash alternatives, parallel calls when independent
- **Git safety** — new commits over amends, explicit staging, no hook skipping, no force push
- **Subagent delegation** — spawn read-only explorers for broad search, parallelize independent research
- **Stuck recovery** — detect loops, challenge assumptions, simplify or ask rather than spin
- **Smart compaction** — preserve decisions, file paths, git state, and task progress in summaries
- **Output efficiency** — concise, action-first, no filler, file:line references
- **Data safety** — never post to public services without explicit approval

# ra-claude-code

A coding agent recipe that replicates Claude Code's context engineering and safety-first behavior using ra. Interactive REPL with extended thinking, on-demand skills, and careful execution principles.

## What It Does

- **Always-on system prompt:** Core behavior baked into `systemPrompt` — autonomous execution, read-before-write, minimal changes, over-engineering prevention, safety-first, tool discipline, output efficiency
- **On-demand skills:** 9 skills discovered automatically from `skillDirs`. The model sees their descriptions and activates them when the task calls for it (e.g., activates `quick-commit` when the user asks to commit)
- **Full tool access:** Filesystem (Read/Write/Edit/Glob/Grep), shell (Bash), web fetch, user interaction, checklist tracking
- **Smart compaction:** Custom summarization prompt preserves file paths, decisions, git state, and task progress when context is compressed
- **Session memory:** Persists knowledge across sessions
- **Extended thinking:** Opus with high thinking budget for complex reasoning
- **Token budget:** Configurable hard stop (800k default) to prevent runaway sessions

## Skills (on-demand)

The model sees all skills as available and activates them based on the task. Descriptions are written as triggers.

| Skill | Activates when... |
|-------|-------------------|
| `planner` | Task has 5+ steps, spans multiple files, or requires architectural decisions |
| `debugger` | Diagnosing a bug, test failure, or unexpected behavior |
| `verify` | After making code changes, before committing, or before claiming done |
| `git-workflow` | Any git operation — branching, merging, rebasing, conflict resolution |
| `quick-commit` | User asks to commit changes |
| `quick-pr` | User asks to create a pull request |
| `code-style` | Reviewing code, writing new code, or discussing code quality |
| `explore-delegate` | Need to search broadly, explore multiple areas, or parallelize research |
| `stuck-recovery` | Same error 3+ times, retrying with minor variations, no progress |

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

## Architecture

```
ra.config.yaml
├── systemPrompt          # Always-on: autonomous execution, safety, tool discipline
├── skills/               # On-demand: model activates based on task
│   ├── planner/          #   complex task decomposition
│   ├── debugger/         #   systematic bug diagnosis
│   ├── verify/           #   post-change type-check/lint/test
│   ├── git-workflow/     #   git safety rules
│   ├── quick-commit/     #   commit protocol
│   ├── quick-pr/         #   PR creation protocol
│   ├── code-style/       #   code quality + OWASP checklist
│   ├── explore-delegate/ #   subagent delegation patterns
│   └── stuck-recovery/   #   loop detection + strategy change
├── middleware/
│   └── token-budget.ts   # Hard stop at configurable token limit
└── compaction prompt      # Preserves decisions, files, git state in summaries
```

Inspired by [Claude Code's system prompts](https://github.com/Piebald-AI/claude-code-system-prompts) — distills 110+ conditional prompt components into a focused system prompt + 9 on-demand skills.

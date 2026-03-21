# ra-claude-code

A coding agent that thinks before it edits. Built on [ra](https://github.com/chinmaymk/ra).

```bash
ra --config recipes/ra-claude-code/ra.config.yaml
```

## What You Get

- **Reads before it writes.** The agent reads files, matches exact strings, and verifies after editing. No guessing.
- **Discovers your project.** Reads `package.json`, checks `git status`, finds your test/lint/build commands on first interaction.
- **Picks up your rules.** Auto-discovers `CLAUDE.md`, `AGENTS.md`, `.cursorrules` from your project.
- **Stays on track.** Extended thinking (Opus), smart context compaction, session memory, and a token budget that stops runaway loops.
- **9 on-demand skills.** The agent activates them based on what you're doing — you don't manage them.

## Skills

| Skill | Kicks in when... |
|-------|-----------------|
| `planner` | 5+ step tasks, multi-file changes, architectural decisions |
| `debugger` | Bug diagnosis — reproduce, isolate, hypothesize, fix, verify |
| `verify` | After changes — runs type-check, lint, test, build in order |
| `git-workflow` | Any git operation — safety rules for destructive commands |
| `quick-commit` | "commit this" — parallel status/diff/log, conventional message |
| `quick-pr` | "make a PR" — analyzes all branch commits, pushes, creates PR |
| `code-style` | Writing or reviewing code — correctness, security, simplicity |
| `explore-delegate` | Broad codebase search — spawns parallel subagents |
| `stuck-recovery` | Same error 3+ times — forces a strategy change |

## Setup

1. Install [ra](https://github.com/chinmaymk/ra)
2. Set `ANTHROPIC_API_KEY`
3. Run it:

```bash
# Interactive REPL
ra --config recipes/ra-claude-code/ra.config.yaml

# One-shot
ra --config recipes/ra-claude-code/ra.config.yaml --interface cli "fix the failing tests"
```

## Configuration

**Switch model:**
```yaml
agent:
  model: claude-sonnet-4-6   # faster, cheaper
  thinking: medium
```

**Token budget** (default 800k):
```bash
export RA_TOKEN_BUDGET=500000
```

**Iteration limit** (default 200):
```yaml
agent:
  maxIterations: 100
```

**GitHub integration** — uncomment the `mcp` section in `ra.config.yaml` and set `GITHUB_TOKEN`.

## How It Works

```
ra.config.yaml
├── systemPrompt        # Always-on: read-before-write, minimal edits, safety, tool discipline
├── skills/             # On-demand: model activates based on task
├── middleware/
│   └── token-budget.ts # Hard stop at token limit
└── compaction prompt   # Preserves file paths, decisions, git state across summaries
```

The system prompt handles core editing reliability — exact string matching, reading files before editing, environment discovery. Skills layer on specialized workflows (debugging, git, planning) only when needed. Compaction ensures long sessions don't lose context.

Inspired by [Claude Code's prompt architecture](https://github.com/anthropics/claude-code) — distilled into a focused system prompt + 9 on-demand skills.

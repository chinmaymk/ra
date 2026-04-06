# oh-my-ra

Batteries-included agent recipe for ra. 16 skills, 8 middleware hooks, and 2 custom tools — everything you need for autonomous coding, research, debugging, and delivery.

Inspired by [oh-my-claude](https://github.com/TechDufus/oh-my-claude) and [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), built natively on ra's middleware and skills system.

## Quick Start

```bash
bun run ra --config recipes/oh-my-ra/ra.config.yaml
```

Override the provider or model:

```bash
PROVIDER=openai MODEL=gpt-4o bun run ra --config recipes/oh-my-ra/ra.config.yaml
```

## What's Included

### Skills (16)

#### Workflow

| Skill | What it does |
|-------|-------------|
| `/ultrawork` | Full autonomous pipeline: clarify → plan → execute → verify → self-review → report |
| `/interview` | Socratic clarification — max 5 targeted questions with defaults before acting |
| `/deep-research` | Spawn 2-4 parallel research agents, synthesize findings into structured report |
| `/team` | Decompose tasks into specialist roles, dispatch parallel agents, merge output |
| `/pair` | Interactive pair programming — explain decisions, think out loud, check in at decision points |

#### Engineering

| Skill | What it does |
|-------|-------------|
| `/debugger` | Systematic 7-step debugging: reproduce → isolate → understand → hypothesize → verify → fix → confirm |
| `/architect` | System design — propose 2-3 approaches with trade-off analysis, recommend one |
| `/refactor` | Safe incremental restructuring with green-to-green verification after every step |
| `/test-writer` | Discover test framework and conventions, plan cases, write thorough tests |
| `/explain` | Deep code explanation — trace data flow, map dependencies, explain the "why" |
| `/migrate` | Phased migration with rollback points — version upgrades, framework changes, API transitions |

#### Quality & Delivery

| Skill | What it does |
|-------|-------------|
| `/critic` | Post-completion quality review — correctness, edge cases, security, maintainability |
| `/security-audit` | OWASP Top 10 checklist with auto-discovery script and reference cheatsheet |
| `/commit` | Pre-commit checks script, staged diff review, conventional commit messages |
| `/pr` | Full PR workflow — run checks, write description, add reviewer notes |
| `/stuck` | Loop recovery — challenge assumptions, reframe the problem, try a new angle |

### Middleware (8)

Every hook in the agent loop is covered:

| Middleware | Hook | What it does |
|-----------|------|-------------|
| **repo-context** | `beforeLoopBegin` | Injects git branch, recent commits, uncommitted changes, package.json |
| **auto-skill** | `beforeLoopBegin` | Pattern-matches user input and suggests relevant skills |
| **context-guard** | `beforeModelCall` | Monitors context window usage, warns at 70%, alerts at 85% |
| **token-budget** | `afterModelResponse` | Hard token budget with configurable limit (default: 800k) |
| **quality-gate** | `beforeToolExecution` | Blocks `rm -rf`, `git push --force`, secret file writes, credential leaks |
| **progress-tracker** | `afterLoopIteration` | Logs iteration stats to stderr — tokens, cache hits, tool calls |
| **loop-guard** | `afterLoopIteration` | Detects repeated errors and suggests `/stuck` to break the loop |
| **session-summary** | `afterLoopComplete` | Prints session summary on completion — iterations, tokens, errors |

### Custom Tools (2)

| Tool | What it does |
|------|-------------|
| **ProjectScan** | Discovers project structure, tech stack, frameworks, test runner, scripts, and convention files |
| **DependencyCheck** | Audits dependencies for vulnerabilities, outdated packages, and licenses (npm/pip/cargo) |

### Skill Scripts (auto-run on activation)

| Script | Skill | What it discovers |
|--------|-------|-------------------|
| `discover.sh` | `/security-audit` | HTTP endpoints, auth code, DB queries, hardcoded secrets, git-tracked sensitive files |
| `context.sh` | `/debugger` | Recent git changes, changed files, test file locations |
| `pre-check.sh` | `/commit` | Staged/unstaged diffs, debug artifacts, merge conflict markers |

### Reference Documents

| Reference | Skill | Content |
|-----------|-------|---------|
| `owasp-quick-ref.md` | `/security-audit` | OWASP Top 10 (2021) quick reference with check items per category |

## Configuration

### Token Budget

Set `RA_TOKEN_BUDGET` to control the hard token limit (default: 800,000):

```bash
RA_TOKEN_BUDGET=500000 bun run ra --config recipes/oh-my-ra/ra.config.yaml
```

### Agent Concurrency

Subagent parallelism is configured in `ra.config.yaml`:

```yaml
tools:
  overrides:
    Agent:
      maxConcurrency: 4  # max parallel subagents
      maxDepth: 3         # max nesting depth
```

### Compaction

Context compaction triggers at 80% of the context window. The custom compaction prompt preserves task state, plans, research findings, and git context across compaction boundaries.

### Memory

Persistent memory is enabled by default — the agent remembers key decisions across sessions.

## Structure

```
recipes/oh-my-ra/
├── ra.config.yaml              # Main config — provider, model, system prompt, middleware wiring
├── skills/
│   ├── architect/SKILL.md
│   ├── commit/
│   │   ├── SKILL.md
│   │   └── scripts/pre-check.sh
│   ├── critic/SKILL.md
│   ├── debugger/
│   │   ├── SKILL.md
│   │   └── scripts/context.sh
│   ├── deep-research/SKILL.md
│   ├── explain/SKILL.md
│   ├── interview/SKILL.md
│   ├── migrate/SKILL.md
│   ├── pair/SKILL.md
│   ├── pr/SKILL.md
│   ├── refactor/SKILL.md
│   ├── security-audit/
│   │   ├── SKILL.md
│   │   ├── scripts/discover.sh
│   │   └── references/owasp-quick-ref.md
│   ├── stuck/SKILL.md
│   ├── team/SKILL.md
│   ├── test-writer/SKILL.md
│   └── ultrawork/SKILL.md
├── middleware/
│   ├── auto-skill.ts
│   ├── context-guard.ts
│   ├── loop-guard.ts
│   ├── progress-tracker.ts
│   ├── quality-gate.ts
│   ├── repo-context.ts
│   ├── session-summary.ts
│   └── token-budget.ts
└── tools/
    ├── dep-check.ts
    └── project-scan.ts
```

## How It Works

The agent loop runs with all 8 middleware hooks wired in:

```
User message
  → [repo-context] injects git state
  → [auto-skill] suggests relevant skills
  → [context-guard] checks context window usage
  → Model generates response
  → [token-budget] checks if budget exceeded
  → [quality-gate] validates each tool call before execution
  → Tools execute
  → [progress-tracker] logs iteration stats
  → [loop-guard] checks for repeated errors
  → Repeat until done
  → [session-summary] prints final stats
```

Skills are invoked by the user (`/debugger`) or suggested by the auto-skill middleware when it detects matching patterns in the user's message. Skills with `scripts/` directories auto-run discovery on activation. Skills with `references/` directories make reference material available to the agent.

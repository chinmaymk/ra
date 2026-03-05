# Code Review Agent Recipe Design

## Overview

A self-contained recipe demonstrating ra's value: an AI code review agent that would take days to build from scratch but is trivial with ra. One config file, one skill, one middleware — and you have a production-grade PR reviewer.

## Structure

```
recipes/code-review-agent/
├── ra.config.yaml              # Ra config wiring everything together
├── skills/
│   └── code-review/
│       ├── SKILL.md            # Review expertise + structured output format
│       └── references/
│           └── review-guide.md # Detailed review criteria (OWASP, common bugs, etc.)
├── middleware/
│   └── token-budget.ts         # Enforces max token spend per review
├── demo.sh                     # ra invocations showing different usage patterns
└── README.md                   # What it does, how to run it
```

## Config (`ra.config.yaml`)

```yaml
provider: anthropic
model: claude-sonnet-4-6
interface: cli
systemPrompt: ""
skills:
  - code-review
skillDirs:
  - ./skills
mcp:
  client:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
middleware:
  afterModelResponse:
    - ./middleware/token-budget.ts
maxIterations: 10
compaction:
  enabled: true
  threshold: 0.8
```

## Demo (`demo.sh`)

Pure ra invocations composing with Unix tools:

```sh
# Pipe a git diff directly
git diff main | ra --config ra.config.yaml "Review this diff"

# Pipe a PR diff from gh CLI
gh pr diff 42 | ra --config ra.config.yaml "Review this PR"

# Pipe a specific file for security review
cat src/auth.ts | ra --config ra.config.yaml "Review this file for security issues"

# Run as HTTP API for webhook integration
ra --config ra.config.yaml --interface http
```

## Skill: `code-review/SKILL.md`

Frontmatter:
- `name: code-review`
- `description: Reviews code for bugs, security, style, and correctness`
- `allowedTools: ["github"]`

Body provides:
- **Review framework** — what to look for: correctness, security, performance, readability
- **Severity levels** — critical / warning / suggestion / nitpick
- **Output format** — structured markdown with file/line references, severity, explanation
- **Principles** — focus on what matters, don't nitpick formatting, explain the "why"

`references/review-guide.md` contains detailed criteria (OWASP top 10 for security, common bug patterns, performance anti-patterns) injected as reference context.

## Middleware: `token-budget.ts`

An `afterModelResponse` hook that:
- Tracks cumulative token usage across iterations
- Calls `ctx.stop()` if usage exceeds a configurable limit
- Prevents runaway reviews on huge PRs
- Logs a summary of tokens consumed

## Data Flow

```
User input (piped diff / PR reference)
  → beforeLoopBegin
  → beforeModelCall
  → Model (with code-review skill as system context)
  → Model calls MCP tools if needed (fetch PR diff, list files, read comments)
  → afterToolExecution
  → Model produces structured review
  → afterModelResponse (token-budget middleware checks spend)
  → afterLoopComplete
  → Structured review output to stdout
```

## Design Decisions

- **One middleware only** — the skill prompt handles structured output; no need for a validation middleware
- **MCP for GitHub** — uses the official `@modelcontextprotocol/server-github` package; optional (piped diffs work without it)
- **CLI as default interface** — composes with Unix pipes; can switch to HTTP for webhooks
- **Stdin support** — `git diff | ra` is the primary workflow, natural for developers

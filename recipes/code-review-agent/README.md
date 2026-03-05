# Code Review Agent

An AI-powered code review agent built with ra. Pipe any diff or source file into it and get structured, actionable feedback.

## Prerequisites

- [ra](../../README.md) installed
- `ANTHROPIC_API_KEY` environment variable set
- (Optional) `GITHUB_TOKEN` for GitHub MCP integration

## Quick Start

```bash
# From the repository root, install dependencies
bun install

# Review staged changes
git diff --cached | ra --config recipes/code-review-agent/ra.config.yaml "Review this diff"

# Review the last commit
git diff HEAD~1 | ra --config recipes/code-review-agent/ra.config.yaml "Review this diff"
```

## Usage

The agent reads code from stdin and produces a structured review with findings classified by severity (critical, warning, suggestion, nitpick).

```bash
# Review a specific file
cat src/server.ts | ra --config ra.config.yaml "Review this file for security issues"

# Review a GitHub PR
gh pr diff 42 | ra --config ra.config.yaml "Review this PR"

# Review with a custom token budget
RA_TOKEN_BUDGET=100000 git diff main | ra --config ra.config.yaml "Review this diff"
```

## Customization

### Model

Edit `ra.config.yaml` to change the provider or model:

```yaml
provider: anthropic
model: claude-sonnet-4-6  # or claude-opus-4-6 for deeper reviews
```

### Token Budget

Set the `RA_TOKEN_BUDGET` environment variable to control how many tokens the agent can use (default: 200,000):

```bash
RA_TOKEN_BUDGET=100000 git diff | ra --config ra.config.yaml "Review this diff"
```

### Skill

Edit `skills/code-review/SKILL.md` to customize the review framework, severity levels, or output format. Add domain-specific checklists to `skills/code-review/references/`.

### GitHub MCP

The config includes a GitHub MCP server for PR and issue context. Set `GITHUB_TOKEN` to enable it.

## How It Works

1. **Config** (`ra.config.yaml`) — Sets up the model, skills, middleware, and MCP servers
2. **Skill** (`skills/code-review/SKILL.md`) — Defines the review framework and output format
3. **References** (`skills/code-review/references/`) — Provides checklists the model can consult
4. **Middleware** (`middleware/token-budget.ts`) — Stops the agent if it exceeds the token budget
5. **MCP** — GitHub server provides PR/issue context when `GITHUB_TOKEN` is set

The agent composes with Unix tools via stdin piping — `git diff`, `cat`, `gh pr diff`, or any command that outputs code.

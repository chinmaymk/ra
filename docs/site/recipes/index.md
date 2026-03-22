# Recipes

Recipes are complete, shareable agent configurations. A recipe bundles a `ra.config.yaml` with skills, middleware, and documentation into a self-contained agent you can install, run, and customize.

## Install and use

Install recipes from GitHub, npm, or a URL:

```bash
# From GitHub (default)
ra recipe install user/repo

# From npm
ra recipe install npm:ra-recipe-review

# From a URL
ra recipe install https://example.com/recipe.tar.gz

# Explicit GitHub prefix
ra recipe install github:user/repo
```

Use an installed recipe with `--recipe`:

```bash
ra --recipe user/repo "your prompt here"
```

Or reference it in `ra.config.yaml`:

```yaml
agent:
  recipe: user/repo
```

### Manage installed recipes

```bash
# List all installed recipes
ra recipe list

# Remove an installed recipe
ra recipe remove user/repo
```

Installed recipes live in `~/.ra/recipes/`. Each stores a `.source.json` with install metadata.

### Config layering

Recipes act as a base config layer. The merge order is:

```
defaults < recipe < file config < CLI flags
```

Your local `ra.config.yaml` and CLI flags always override recipe values. Array fields like `skillDirs`, `middleware`, and `mcpServers` are prepended from the recipe rather than replaced, so you can extend a recipe without losing its defaults.

### Local recipes

Point `--recipe` at a local directory instead of an installed name:

```bash
ra --recipe ./my-recipes/custom-agent "prompt"
```

Or use `--config` to load a recipe's config file directly:

```bash
ra --config recipes/coding-agent/ra.config.yaml
```

## Pre-built recipes

ra ships with five ready-to-use recipes in the `recipes/` directory.

### Coding Agent

General-purpose coding agent with file editing, shell execution, codebase navigation, extended thinking, and smart context compaction. Includes on-demand specialist skills for debugging, planning, architecture, code style, and documentation.

```bash
ra --config recipes/coding-agent/ra.config.yaml
```

**Key settings:** Opus, high thinking, 200 max iterations, compaction at 80%.

### Code Review Agent

Reviews diffs for correctness, security, style, and performance. Connects to GitHub via MCP, includes a style guide reference, and enforces a token budget via middleware. Designed for piped input.

```bash
git diff --cached | ra --config recipes/code-review-agent/ra.config.yaml "Review this diff"
gh pr diff 42 | ra --config recipes/code-review-agent/ra.config.yaml "Review this PR"
```

**Key settings:** configurable provider/model via env vars, 10 max iterations, token budget middleware.

### Multi-Agent Orchestrator

An orchestrator that dynamically creates specialist agents as independent ra processes. The model writes `ra.config.yaml` files and runs them with `ra --cli` — no custom tools needed, just Write + Bash.

```bash
ra --config recipes/multi-agent/ra.config.yaml
ra --config recipes/multi-agent/ra.config.yaml --cli "Review src/ for security and performance issues"
```

**Key settings:** Sonnet, medium thinking, 50 max iterations. Child agents get their own configs and can be resumed with `--resume`.

### ra-claude-code

A full-featured coding agent inspired by Claude Code's prompt architecture. Reads before it writes, discovers your project setup, picks up rule files (`CLAUDE.md`, `.cursorrules`), and activates 10 on-demand skills based on what you're doing.

```bash
ra --config recipes/ra-claude-code/ra.config.yaml
```

| Skill | Activates when... |
|-------|------------------|
| `plan` | 5+ step tasks, multi-file changes |
| `debugger` | Bug diagnosis needed |
| `verify` | After making changes |
| `git-workflow` | Any git operation |
| `quick-commit` | "commit this" |
| `quick-pr` | "make a PR" |
| `code-style` | Writing or reviewing code |
| `explore-delegate` | Broad codebase search |
| `todo` | Multi-step work tracking |
| `stuck-recovery` | Same error 3+ times |

**Key settings:** Opus, high thinking, 200 max iterations, token budget middleware, session memory, custom compaction prompt.

### Karpathy Autoresearch

Autonomous ML research agent based on [karpathy/autoresearch](https://github.com/karpathy/autoresearch). Iteratively modifies a training script, runs 5-minute experiments, evaluates results, and keeps or discards changes without human intervention.

```bash
cd /path/to/autoresearch
ra --config /path/to/ra/recipes/karpathy-autoresearch/ra.config.yaml
```

**Key settings:** Sonnet, 500 max iterations, 15-min tool timeout, unrestricted shell access, WebFetch and Agent tools disabled.

## Common patterns

### Project-specific agent

Drop a `ra.config.yml` in your repo:

```yaml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  systemPrompt: |
    You are an expert on this codebase. You know TypeScript, Bun, and the project structure.
    When asked to make changes, write the code directly — don't describe what to do.

  skillDirs:
    - .ra/skills
```

Now `ra` in that directory becomes a project-aware agent.

### CI code reviewer

```yaml
# .github/workflows/review.yml
- name: Review PR
  run: git diff origin/main | ra --skill code-review "Review this PR diff"
```

### Pipe and chain

```bash
# Summarize a log file
cat server.log | ra "Summarize errors in the last 100 lines"

# Review a diff
git diff | ra --skill code-review "Review this diff"

# Chain: extract → summarize
ra "List all TODO comments" | ra "Group by priority and format as a table"
```

### Extend a recipe with local config

Use a recipe as a base and override specific settings locally:

```yaml
# ra.config.yaml
agent:
  recipe: user/coding-agent
  model: claude-sonnet-4-6   # override recipe's model
  maxIterations: 50           # override recipe's iteration limit
  skillDirs:
    - .ra/project-skills      # added alongside recipe's skills
```

### MCP tool in Claude Desktop

```json
{
  "mcpServers": {
    "project-agent": {
      "command": "ra",
      "args": ["--mcp-stdio"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

## See also

- [Creating Recipes](/recipes/creating-recipes) — build and share your own recipes
- [Dynamic Prompts](/recipes/dynamic-prompts) — advanced middleware patterns for context injection
- [Skills](/skills/) — creating and using skills
- [Middleware](/middleware/) — hooks for custom behavior
- [Configuration](/configuration/) — all config fields

# Recipes

Recipes are complete agent configurations — a `ra.config.yaml` bundled with skills, middleware, and assets. Install them from GitHub or npm, or create your own.

## Using a recipe

### From an installed recipe

```bash
# Install once
ra recipe install chinmaymk/ra

# Use by name
ra --recipe chinmaymk/coding-agent "Implement the login page"
```

### From a local directory

```bash
ra --recipe ./my-recipe "Review the PR"
```

### In your config file

```yaml
# ra.config.yaml
agent:
  recipe: chinmaymk/coding-agent
  model: claude-sonnet-4-6    # overrides the recipe's model
```

The merge order is: **defaults < recipe < config file < CLI flags**. Your local config always wins over the recipe.

## Installing recipes

Bare names default to GitHub:

```bash
ra recipe install chinmaymk/ra              # GitHub (default)
ra recipe install github:chinmaymk/ra       # GitHub (explicit)
ra recipe install npm:ra-recipe-review       # npm package
ra recipe install https://example.com/r.tgz  # URL tarball
```

A single repo can contain multiple recipes. The installer looks for a `recipes/` folder with subdirectories, each containing a `ra.config.{yaml,yml,json,toml}`. Falls back to a root-level config for single-recipe repos.

### Manage installed recipes

```bash
ra recipe list                          # list all installed recipes
ra recipe remove chinmaymk/coding-agent # remove one
```

Recipes are stored in `~/.ra/recipes/`.

## Pre-built recipes

ra ships with ready-to-use recipes in the repo's `recipes/` directory:

| Recipe | Purpose |
|--------|---------|
| `coding-agent` | General-purpose coding with file editing, shell, codebase nav, extended thinking |
| `code-review-agent` | Reviews diffs for correctness, style, performance via GitHub MCP |
| `karpathy-autoresearch` | Autonomous research agent with deep web search |
| `multi-agent` | Orchestrates multiple sub-agents for complex tasks |
| `ra-claude-code` | Claude Code–compatible agent configuration |

```bash
ra recipe install chinmaymk/ra
ra --recipe chinmaymk/coding-agent "Build the feature"
```

## Creating a recipe

A recipe is a directory with a config file and optional assets:

```
my-recipe/
  ra.config.yaml        # required
  skills/               # optional — bundled skills
    review/
      SKILL.md
  middleware/            # optional — bundled middleware
    inject-context.ts
  system-prompt.md      # optional — referenced from config
```

### Recipe config

A recipe config is a standard `ra.config.yaml`. Relative paths are resolved against the recipe directory:

```yaml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  maxIterations: 100
  systemPrompt: ./system-prompt.md

  skillDirs:
    - ./skills

  middleware:
    beforeModelCall:
      - ./middleware/inject-context.ts

  mcp:
    servers:
      - name: github
        transport: stdio
        command: npx
        args: ["-y", "@modelcontextprotocol/server-github"]
        env:
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
```

### How merging works

When a recipe is loaded, its config becomes a base layer. Your local config and CLI flags override it:

| Field | Behavior |
|-------|----------|
| Scalars (`model`, `provider`, etc.) | Local config wins |
| `skillDirs` | Recipe dirs are **prepended** to local dirs |
| `mcp.servers` | Recipe servers are **prepended** to local servers |
| `middleware` hooks | Recipe hooks are **prepended** to local hooks |

This means recipe skills, MCP servers, and middleware are always available alongside your own.

### Publishing to GitHub

Structure your repo with a `recipes/` folder:

```
my-recipes-repo/
  recipes/
    coding-agent/
      ra.config.yaml
      skills/
      middleware/
    review-agent/
      ra.config.yaml
```

Users install with:

```bash
ra recipe install yourname/my-recipes-repo
```

This installs each subdirectory as a separate recipe (`yourname/coding-agent`, `yourname/review-agent`).

### Publishing to npm

```bash
npm publish  # package must contain ra.config.yaml or recipes/ folder
```

Users install with:

```bash
ra recipe install npm:your-package-name
```

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
  run: git diff origin/main | ra --recipe chinmaymk/code-review-agent "Review this PR diff"
```

### Pipe and chain

```bash
cat server.log | ra "Summarize errors in the last 100 lines"
git diff | ra --recipe chinmaymk/code-review-agent "Review this diff"
ra "List all TODO comments" | ra "Group by priority and format as a table"
```

## See also

- [Dynamic Prompts](/recipes/dynamic-prompts) — advanced middleware patterns for context injection
- [Skills](/skills/) — creating and using skills
- [Middleware](/middleware/) — hooks for custom behavior
- [Configuration](/configuration/) — all config fields

# Recipes

A recipe is a complete agent configuration — provider, model, skills, middleware, and config — packaged as a directory you can install and run. It's how you share and reuse agent setups.

## What's in a recipe

```
recipes/coding-agent/
  ra.config.yaml     # full agent config
  skills/            # skills specific to this recipe
  middleware/         # middleware specific to this recipe
  README.md
```

The config file is a standard ra config. The skills and middleware directories follow the same conventions as any other ra project.

## Using a recipe

Run a recipe by name:

```bash
ra --recipe coding-agent "Fix the failing test in auth.ts"
```

Or install one from a remote source:

```bash
ra recipe install github:user/my-agent-recipe
ra recipe install npm:my-agent-recipe@latest
```

## How config layering works

When you use a recipe, its config merges with your other config sources:

```
defaults < recipe < config file < CLI flags
```

The recipe provides a baseline. Your local config file overrides it. CLI flags override everything. Array fields like `skillDirs` and `middleware` are prepended from the recipe, not replaced — so the recipe's skills add to yours rather than wiping them out.

## Built-in recipes

ra ships with several recipes to get you started:

| Recipe | What it does |
|--------|-------------|
| `coding-agent` | Full coding workflow with thinking, compaction, and specialist skills |
| `code-review-agent` | Focused code review with style guide awareness |
| `multi-agent` | Orchestrates multiple sub-agents for complex tasks |

## Building your own

A recipe is just a directory with a `ra.config.yaml`. Start from one of the built-in recipes, customize the system prompt, add skills for your domain, wire in middleware for your workflow.

See [Creating Recipes](/recipes/creating-recipes) for a step-by-step guide.

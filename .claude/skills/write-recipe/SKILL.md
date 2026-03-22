---
name: write-recipe
description: Use when creating a new ra recipe — a complete agent configuration with skills, middleware, and config.
---

# Writing a Recipe

A recipe is a self-contained agent configuration. Copy the directory, run it — everything works.

## Structure

```
recipes/<name>/
  ra.config.yaml       # Agent configuration
  README.md            # What it does, how to run it
  skills/              # Bundled skills (MUST be self-contained)
    <skill-name>/
      SKILL.md         # YAML frontmatter + instructions
      scripts/         # Optional: run at activation, stdout → context
      references/      # Optional: injected as context
  middleware/           # Optional: lifecycle hooks
    <hook>.ts
```

## Checklist

1. **Define the agent** — one sentence: "A code reviewer that reads diffs and gives structured feedback."

2. **Write skills** — `skills/<name>/SKILL.md`:
   - YAML frontmatter: `name`, `description`
   - Markdown body: role, process, output format
   - Optional `scripts/` for dynamic context (git diff, env vars, etc.)

3. **Write config** — `ra.config.yaml`:
```yaml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  skillDirs:
    - ./skills                      # always relative to recipe dir
  maxIterations: 10                 # 10 for focused tasks, 50+ for exploratory
  # Optional:
  mcp:
    servers:
      - name: github
        transport: stdio
        command: npx
        args: ["-y", "@modelcontextprotocol/server-github"]
  middleware:
    afterModelResponse:
      - ./middleware/token-budget.ts
```

4. **Add middleware** (optional) — common hooks: token budget, tool filtering, logging

5. **Write README** — install, configure, run

6. **Test** — `cd recipes/<name> && ra --config ra.config.yaml "test prompt"`

## Rules

- **Recipes must be self-contained** — bundle all skills inside `skills/`, use `skillDirs: [./skills]`
- Never reference paths outside the recipe directory (`../../skills` is wrong)
- Skill scripts should be fast — they block activation
- See existing recipes in `recipes/coding-agent/` and `recipes/code-review-agent/` for reference

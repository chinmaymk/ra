---
name: write-recipe
description: Use when creating a new ra recipe — a complete agent configuration with skills, middleware, and config.
---

# Writing a Recipe

A recipe is a complete agent you can run out of the box. It combines a config file, skills, and optional middleware into a self-contained directory.

## Structure

```
recipes/<name>/
  ra.config.yaml       # Agent configuration
  README.md            # What this recipe does, how to run it
  skills/
    <skill-name>/
      SKILL.md         # Frontmatter + instructions
      scripts/         # Optional: run at activation
      references/      # Optional: injected as context
  middleware/           # Optional: lifecycle hooks
    <hook>.ts
  demo.sh              # Optional: runnable demo
```

## Reference: `code-review-agent` recipe

```yaml
# ra.config.yaml
provider: anthropic
model: claude-sonnet-4-6
interface: cli
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
middleware:
  afterModelResponse:
    - ./middleware/token-budget.ts
maxIterations: 10
```

## Steps

1. **Define the persona** — What agent are you building? One sentence: "A code reviewer that reads diffs and gives structured feedback."

2. **Write the skill** — Create `skills/<name>/SKILL.md` with:
   - YAML frontmatter: `name` and `description`
   - Markdown body: role, process, output format
   - Optional `scripts/` for activation-time context gathering
   - Optional `references/` for injected documentation

3. **Write the config** — `ra.config.yaml`:
   - Set `interface: cli` for one-shot, `repl` for interactive
   - Reference the skill by name, set `skillDirs: [./skills]`
   - Add MCP servers if the agent needs external tools
   - Set appropriate `maxIterations` (10 for focused tasks, 50 for exploratory)

4. **Add middleware** (optional) — Common hooks:
   - Token budget in `afterModelResponse`
   - Tool filtering in `beforeModelCall`
   - Logging in `afterToolExecution`

5. **Write the README** — How to install, configure, and run the recipe

6. **Test it** — Run the recipe end-to-end:
   ```bash
   cd recipes/<name>
   ra --config ra.config.yaml "test prompt"
   ```

## Skill Script Tips

- Scripts in `skills/<name>/scripts/` run at activation. Their stdout becomes context for the model.
- Use for dynamic context: `git diff`, `ls`, reading env vars.
- Shebangs are respected: `#!/usr/bin/env python3` works.
- Keep scripts fast — they block skill activation.

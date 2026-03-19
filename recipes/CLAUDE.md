Complete agent configurations — ready-to-use examples that combine config, skills, and middleware.

**Structure:**
Each recipe is a self-contained directory:
```
recipes/<name>/
  ra.config.yaml    # Full ra config (provider, model, skills, middleware)
  README.md         # Usage instructions
  skills/           # Recipe-specific skills (SKILL.md + optional scripts/references)
  middleware/       # Recipe-specific middleware files
  demo.sh          # Optional demo script
```

**Existing Recipes:**
- `coding-agent/` — Full coding agent with architect, planner, debugger, code-style, and writer skills
- `code-review-agent/` — Code review agent with review skill, reference guide, and token-budget middleware

**Creating a New Recipe:**
1. Create a directory under `recipes/`
2. Add `ra.config.yaml` with provider, model, skills, and middleware config
3. Add skills as subdirectories under `skills/` (each needs a `SKILL.md`)
4. Add middleware files under `middleware/` if needed
5. Add a `README.md` explaining usage
6. Test with `bun run ra --config recipes/<name>/ra.config.yaml`

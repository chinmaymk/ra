Self-contained agent configurations combining config, skills, and middleware.

**Layout:**
```
recipes/<name>/
  ra.config.yaml   # Provider, model, skills, middleware
  skills/          # SKILL.md per skill + optional scripts/references
  middleware/      # Middleware files
  README.md
```

**Existing:** `coding-agent/`, `code-review-agent/`, `auto-improve/`, `karpathy-autoresearch/`, `multi-agent/`, `oh-my-ra/`, `ra-claude-code/`

Test with: `bun run ra --config recipes/<name>/ra.config.yaml`

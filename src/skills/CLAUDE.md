# src/skills/

Skill loading, execution, and installation.

## Files

| File | Purpose |
|------|---------|
| `loader.ts` | `loadSkills()`, `loadSkillMetadata()`, `buildAvailableSkillsXml()`, `buildActiveSkillXml()` |
| `runner.ts` | Executes skill activation scripts (`scripts/` dir) |
| `install.ts` | `installSkill()` — downloads skills from GitHub repositories |
| `types.ts` | `Skill`, `SkillMetadata`, `SkillSource` interfaces |

## Skill Directory Layout

```
skills/<name>/
  SKILL.md         # Required: YAML frontmatter (name, description) + markdown body
  scripts/         # Optional: shell scripts run at activation, stdout → context
  references/      # Optional: files injected as additional context
  assets/          # Optional: static files
```

## How Skills Work

1. `loadSkills()` scans `skillDirs` for `SKILL.md` files
2. Parses YAML frontmatter for metadata (name, description)
3. Markdown body becomes the skill's instructions (injected into system prompt)
4. If `scripts/` exists, scripts run at activation and their stdout is appended as context
5. If `references/` exists, files are read and injected as context

## Built-in Skills (in repo root `skills/`)

`code-review`, `architect`, `planner`, `debugger`, `code-style`, `writer`

These are separate from the `.claude/skills/` which are Claude Code project skills for developing ra itself.

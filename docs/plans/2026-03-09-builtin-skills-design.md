# Built-in Skills Design

## Overview

ra ships with built-in skills embedded in the binary that are always discoverable via `<available_skills>`. Users can disable individual built-in skills via config.

## Built-in Skills (initial set)

- **write-skill** — How to author a SKILL.md, directory structure, scripts, references
- **write-recipe** — How to create a recipe (config + skills + middleware)
- **write-middleware** — How to write middleware hooks

## Source Layout

```
src/skills/builtin/
  write-skill/SKILL.md
  write-recipe/SKILL.md
  write-middleware/SKILL.md
```

Imported at build time using Bun file imports so they're embedded in the compiled binary.

## Config

```yaml
builtinSkills:
  write-skill: true      # default: true
  write-recipe: true      # default: true
  write-middleware: true   # default: true
```

Setting any to `false` excludes it from `<available_skills>`.

Type in `RaConfig`:

```typescript
builtinSkills: Record<string, boolean>
```

Default: all enabled (empty record means all on, explicit `false` disables).

## Loading

New function in `src/skills/builtin.ts`:

- Imports the SKILL.md files, parses frontmatter (reusing existing logic)
- Returns `Map<string, Skill>` filtered by `config.builtinSkills`
- Interfaces merge built-in skills into the available skills map before calling `buildAvailableSkillsXml()`

## Injection

- Built-in skills appear in `<available_skills>` alongside user/recipe skills
- Model reads the full body on demand (same as existing skills)
- No always-on injection, no context-triggering logic

## No Changes To

- Skill format (same SKILL.md frontmatter + body)
- Existing skill loading from `skillDirs`
- Runner, installer, or tool registry

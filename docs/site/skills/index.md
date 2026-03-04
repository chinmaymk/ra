# Skills

Skills are reusable instruction bundles — roles, behaviors, and assets packaged as directories.

## Skill structure

```
skills/
  code-review/
    SKILL.md           # Frontmatter + instructions
    scripts/
      gather-diff.sh   # Model can run on demand for additional context
    references/
      style-guide.md   # Read on demand as reference context
```

**SKILL.md** uses YAML frontmatter:

```yaml
---
name: code-review
description: Reviews code for bugs, style, and best practices
---

You are a senior code reviewer. Focus on:
- Correctness and edge cases
- Performance implications
- Naming and readability
```

## How skills work

Skills follow a progressive disclosure pattern:

1. **Discovery** — Skills found in configured `skillDirs` are presented to the model as `<available_skills>` XML, listing each skill's name, description, and SKILL.md location. The full instructions are not loaded yet.

2. **Activation** — When the model decides a skill is relevant, it reads the full SKILL.md to get the complete instructions.

3. **Always-on** — Skills named in config (`skills: [name]`) or via CLI (`--skill name`) skip discovery. Their full SKILL.md body is injected directly as `<skill name="...">` XML in a user message.

## Using skills

**CLI:**
```bash
ra --skill code-review "Review the latest changes"
```

**REPL:**
```
/skill code-review
```

**Config (always-on):**
```yaml
skills:
  - code-review
skillDirs:
  - ./skills
```

## On-demand scripts and references

Scripts and references are **not** loaded eagerly — they are available on demand via REPL commands:

**Run a script:**
```
/skill-run code-review gather-diff.sh
```
The script output is attached to your next message as context.

**Read a reference:**
```
/skill-ref code-review style-guide.md
```
The reference content is attached to your next message as context.

## Skill directories

Configure where ra looks for skills:

```yaml
skillDirs:
  - ./skills
  - ~/.ra/skills
```

## Installing skills from registries

Ra can download skills from npm, GitHub, or URLs and store them in `~/.ra/skills`.

### Install from npm

```bash
ra skill install code-review                  # bare package name
ra skill install npm:ra-skill-lint            # explicit npm prefix
ra skill install npm:ra-skill-lint@1.2.3      # specific version
```

**npm skill package convention:** Packages can either have a `SKILL.md` at their root, or contain one or more skill subdirectories (each with its own `SKILL.md`). The `ra-skill-` prefix in the package name is stripped when naming the installed skill directory.

### Install from GitHub

```bash
ra skill install github:user/ra-skill-review
```

Downloads the default branch (`main` or `master`) and looks for skill directories within.

### Install from URL

```bash
ra skill install https://example.com/skills.tgz
```

Downloads and extracts a tarball, then installs any skill directories found inside.

### List installed skills

```bash
ra skill list
```

### Remove an installed skill

```bash
ra skill remove code-review
```

### Using installed skills

Add `~/.ra/skills` to your skill directories:

```yaml
skillDirs:
  - ./skills           # project-local skills
  - ~/.ra/skills       # installed skills
```

## Scripts

Skills can include scripts in their `scripts/` directory. These scripts are **not** run automatically at startup or activation. Instead, the model discovers and runs them on demand using filesystem tools when it needs additional context.

```bash
#!/bin/bash
# scripts/gather-diff.sh
git diff --staged
```

**Multi-runtime support** — scripts are detected by shebang, falling back to file extension:

| Extension | Default runtime | Shebang example |
|-----------|----------------|-----------------|
| `.sh` | `sh` | `#!/bin/bash` |
| `.py` | `python3` -> `python` | `#!/usr/bin/env python3` |
| `.ts` | `bun` -> `node` -> `deno` | `#!/usr/bin/env bun` |
| `.js` | `bun` -> `node` -> `deno` | `#!/usr/bin/env node` |
| `.go` | `go run` | `#!/usr/bin/env go` |

TypeScript and JavaScript scripts prefer Bun, falling back to Node then Deno. If a shebang is present, it takes priority over extension-based detection.

## References

Reference files (in the `references/` subdirectory) provide supplementary documentation that can be loaded on demand. They are not included in the initial skill context to keep token usage efficient.

```
references/
  style-guide.md       # Coding style guidelines
  api-patterns.md      # API design patterns
  error-handling.md    # Error handling best practices
```

Use `/skill-ref <skill> <filename>` in the REPL to load a reference into context when needed.

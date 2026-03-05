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
      style-guide.md   # Injected as reference context
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

## Skill directories

Configure where ra looks for skills:

```yaml
skillDirs:
  - ./skills
  - ~/.ra/skills
```

## Installing skills from GitHub

Install community or private skills directly from GitHub:

```bash
ra skill install <github-url>
```

**Supported URL formats:**

```bash
ra skill install owner/repo
ra skill install github.com/owner/repo
ra skill install https://github.com/owner/repo
```

**Pin a specific ref (tag, branch, or commit):**

```bash
ra skill install owner/repo@v2
```

This downloads the tarball from GitHub, locates the top-level `skills/` directory in the repo, validates the skills, and copies them into the first configured `skillDirs` (or `./skills` by default).

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

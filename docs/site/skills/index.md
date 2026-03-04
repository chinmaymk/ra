# Skills

Skills are reusable instruction bundles — roles, behaviors, and assets packaged as directories.

## Skill structure

```
skills/
  code-review/
    SKILL.md           # Frontmatter + instructions
    scripts/
      gather-diff.sh   # Runs at activation, output becomes context
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

## Scripts

Skills can include scripts that run at activation. Their output is injected as context.

```bash
#!/bin/bash
# scripts/gather-diff.sh
git diff --staged
```

**Multi-runtime support** — scripts are detected by shebang:

| Runtime | Shebang |
|---------|---------|
| Bash | `#!/bin/bash` or `#!/usr/bin/env bash` |
| Python | `#!/usr/bin/env python3` |
| TypeScript | `#!/usr/bin/env bun` or `#!/usr/bin/env ts-node` |
| JavaScript | `#!/usr/bin/env node` |
| Go | `#!/usr/bin/env go run` |

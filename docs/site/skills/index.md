# Skills

Skills are reusable instruction bundles — roles, behaviors, and assets packaged as directories. They let you shape what the model does without constraining how it does it.

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

Skills follow a progressive disclosure pattern — the model sees just enough to decide whether to use a skill, then loads the full instructions on demand:

1. **Discovery** — Skills found in configured `skillDirs` are indexed at startup (metadata only). Their names and descriptions are presented to the model as `<available_skills>` XML. The full instructions are **not** loaded yet.

2. **Activation** — When `/skill-name` appears in a prompt, the pattern resolver lazy-loads the full SKILL.md body and injects it as context. This works in any interface (CLI, REPL, HTTP).

3. **REPL shortcut** — In the REPL, typing `/skill-name` as a command queues the skill for injection with your next message.

## Using skills

**CLI** — include `/skill-name` in your prompt:
```bash
ra "/code-review Review the latest changes"
ra "Review this file /code-review"
```

**REPL** — use as a command or inline:
```
› /code-review
Skill "code-review" will be injected with your next message.
› Review the latest changes

› /skill code-review
Skill "code-review" will be injected with your next message.
```

## Hiding skills from the model

By default, all skills in `skillDirs` are listed in `<available_skills>` XML so the model can discover and suggest them. To hide a skill from the model's view — so it is **only** activated when the user explicitly writes `/skill-name` — set `disable-model-invocation` in the frontmatter:

```yaml
---
name: internal-deploy
description: Runs internal deployment checklist
disable-model-invocation: true
---

Follow these deployment steps...
```

The skill is still indexed and resolvable via `/internal-deploy` in a prompt, but the model won't see it in the available skills list and won't invoke it on its own.

## Built-in skills

ra ships with six ready-to-use skills:

| Skill | Purpose |
|-------|---------|
| `code-review` | Reviews code for bugs, security, style, and correctness |
| `architect` | Designs systems and evaluates architecture decisions |
| `planner` | Breaks work into concrete steps before implementation |
| `debugger` | Systematically diagnoses bugs and unexpected behavior |
| `code-style` | Reviews and writes code for clarity, simplicity, and correctness |
| `writer` | Writes clear technical documentation, READMEs, and guides |

```bash
ra "/architect Design a queue system for email notifications"
ra "/debugger Find the root cause" --file crash.log
```

## On-demand scripts and references

Scripts and references are **not** loaded eagerly — they are available on demand via REPL commands:

**Run a script:**
```
› /skill-run code-review gather-diff.sh
```
The script output is attached to your next message as context.

**Read a reference:**
```
› /skill-ref code-review style-guide.md
```
The reference content is attached to your next message as context.

## Skill directories

Configure where ra looks for skills:

```yaml
app:
  skillDirs:
    - ./skills          # project-local skills
    - ~/.ra/skills      # globally installed skills
```

## Installing skills from registries

ra can download skills from npm, GitHub, or URLs and store them in `~/.ra/skills`.

### Install from npm

```bash
ra skill install code-review                  # bare package name
ra skill install npm:ra-skill-lint            # explicit npm prefix
ra skill install npm:ra-skill-lint@1.2.3      # specific version
```

**Package convention:** Packages can either have a `SKILL.md` at their root, or contain one or more skill subdirectories (each with its own `SKILL.md`). The `ra-skill-` prefix in the package name is stripped when naming the installed skill directory.

### Install from GitHub

```bash
ra skill install github:user/ra-skill-review
```

Downloads the default branch and looks for skill directories within.

### Install from URL

```bash
ra skill install https://example.com/skills.tgz
```

Downloads and extracts a tarball, then installs any skill directories found inside.

### Manage installed skills

```bash
ra skill list                     # list installed skills
ra skill remove code-review       # remove a skill
```

After installing, add `~/.ra/skills` to your skill directories:

```yaml
app:
  skillDirs:
    - ./skills           # project-local skills
    - ~/.ra/skills       # installed skills
```

## Scripts

Skills can include scripts in their `scripts/` directory. These are **not** run automatically — the model discovers and runs them on demand when it needs additional context.

```bash
#!/bin/bash
# scripts/gather-diff.sh
git diff --staged
```

**Multi-runtime support** — scripts are detected by shebang, falling back to file extension:

| Extension | Default runtime | Shebang example |
|-----------|----------------|-----------------|
| `.sh` | `sh` | `#!/bin/bash` |
| `.py` | `python3` > `python` | `#!/usr/bin/env python3` |
| `.ts` | `bun` > `node` > `deno` | `#!/usr/bin/env bun` |
| `.js` | `bun` > `node` > `deno` | `#!/usr/bin/env node` |
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

## See also

- [REPL](/modes/repl) — `/skill-name`, `/skill-run`, `/skill-ref` commands
- [Recipes](/recipes/) — pre-built agent configurations using skills
- [Configuration](/configuration/) — `skillDirs` settings

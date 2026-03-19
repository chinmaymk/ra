---
name: write-skill
description: How to author ra skills. Use when creating a new skill directory with SKILL.md, scripts, references, and assets.
---

You are creating a skill for ra. A skill is a self-contained directory that teaches the agent a new capability. Follow this guide exactly.

## Directory Structure

```
my-skill/
  SKILL.md          # required — frontmatter + instructions
  scripts/          # optional — executable scripts the agent can run
    run.ts
    fetch-data.py
  references/       # optional — reference docs injected into context
    API.md
  assets/           # optional — templates, configs, or other static files
    template.json
```

## SKILL.md Format

The file has two parts: YAML frontmatter and a markdown body.

```markdown
---
name: my-skill
description: One sentence explaining what this skill does and when to use it.
license: MIT
compatibility: ">=0.5.0"
metadata:
  author: your-name
  version: "1.0"
---

Instructions for the agent go here. Write in second person ("You are...", "Do this...").
The body is injected directly into the agent's system prompt when the skill is active.
```

### Frontmatter Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | yes | Must exactly match the directory name |
| `description` | yes | Used for discovery — tells the agent when to activate this skill |
| `license` | no | License identifier |
| `compatibility` | no | ra version range |
| `metadata` | no | Arbitrary key-value pairs |

## Key Rules

- **`name` must match the directory name.** If the directory is `my-skill/`, the name field must be `my-skill`. Mismatches cause the skill to be silently skipped.
- **`description` is for discovery.** When skills are available but not active, the agent sees only the name and description. Write it so the agent knows when to load the skill.
- **The body is the instructions.** When a skill is active, the entire markdown body is injected into the system prompt. Write clear, direct instructions.
- **Scripts never auto-execute.** The agent must explicitly choose to run a script via the tool interface. Scripts are listed as available but never triggered automatically.

## Script Runtime Detection

When the agent runs a script, ra picks the runtime using this logic:

1. **Shebang first** — If the file starts with `#!`, the shebang line determines the interpreter. `#!/usr/bin/env python3` runs with `python3`.
2. **Then extension:**
   - `.sh` or no extension — runs with `bash` (falls back to `sh`)
   - `.py` — runs with `python3` (falls back to `python`)
   - `.go` — runs with `go run`
   - `.js`, `.ts` — runs with `bun` (falls back to `node`, then `deno`)

Scripts receive environment variables from the agent session. Write scripts that read input from env vars or stdin and write output to stdout.

## Activation Modes

Skills can be activated three ways:

1. **Always-on** — List the skill name in `config.skills` or pass `--skill my-skill` on the CLI. The skill's body is always in the system prompt.
2. **Available** — Place the skill directory inside a path listed in `config.skillDirs`. The agent sees the name and description, and can load it on demand.
3. **REPL command** — In interactive mode, use `/skill my-skill` to toggle a skill on or off mid-session.

## Loading Skills

Skills are discovered from directories listed in the `skillDirs` config field. You can also install community skills via `ra skill install <name>`, which downloads them into a managed skill directory.

Example `ra.config.yml`:

```yaml
skillDirs:
  - ./skills          # project-local skills
  - ~/.ra/skills      # global user skills

skills:
  - architect         # always active
```

## Writing Good Instructions

- Be specific. "You are a code reviewer" is too vague. "You review pull requests for correctness, security issues, and style violations" tells the agent exactly what to do.
- Include a process. Numbered steps help the agent follow a consistent workflow.
- Define output format. If you want structured output, show the exact format with an example.
- Keep it focused. One skill, one job. If you need multiple capabilities, create multiple skills.

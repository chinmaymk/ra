# Skills

A skill is a reusable bundle of instructions that shapes how your agent behaves. Think of it as a role you give the agent — "you are a code reviewer", "you are a debugger", "you are a technical writer" — along with any scripts, reference files, or context it needs to play that role well.

## What's in a skill

A skill is a directory with a `SKILL.md` file:

```
skills/code-review/
  SKILL.md           # instructions + metadata
  scripts/           # optional: shell scripts run at activation
  references/        # optional: files injected as context
```

The `SKILL.md` has YAML frontmatter and markdown instructions:

```markdown
---
name: code-review
description: Reviews code for bugs, style, and best practices
---

You are a senior code reviewer. Focus on:
- Correctness and edge cases
- Performance implications
- Code style consistency with the existing codebase
```

## How skills activate

Skills use progressive disclosure:

1. **At startup** — ra scans skill directories and shows the model a summary of available skills (name + description only)
2. **On activation** — when the user types `/code-review` or the model invokes a skill, the full instructions are loaded and injected into the conversation

This keeps the context window clean until a skill is actually needed.

## Using skills

From the command line:

```bash
ra --skill code-review "Review the changes in this PR"
```

From the REPL:

```
› /code-review
› Review the auth module for security issues
```

## Scripts and references

**Scripts** run when the skill activates. Their stdout becomes additional context:

```bash
# skills/code-review/scripts/get-style-guide.sh
cat .eslintrc.json
```

**References** are files read and injected as context:

```
skills/code-review/
  references/
    style-guide.md
    review-checklist.md
```

## Skill directories

By default, ra looks for skills in `./.claude/skills`. Add more directories in your config:

```yaml
agent:
  skillDirs:
    - ./skills
    - ~/.ra/skills
```

Skills can also be installed from GitHub or npm via [recipes](/concepts/recipes).

See [Skills reference](/skills/) for the full specification.

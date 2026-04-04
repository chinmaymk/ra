---
name: commit
description: Smart commit workflow. Reviews staged changes, writes conventional commit messages, and catches issues before committing. Use when ready to commit work.
---

You are a commit assistant. You review changes, write clear commit messages, and catch issues before they're committed.

## Process

### 1. Review Changes

```bash
git status
git diff --staged
git diff        # unstaged changes — should these be included?
```

Check for:
- [ ] Unintended changes (debugging code, console.log, commented-out code)
- [ ] Files that shouldn't be committed (.env, credentials, build artifacts, node_modules)
- [ ] Large files that should be in .gitignore
- [ ] Merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)

### 2. Stage Appropriately

- Stage only files related to one logical change
- If there are multiple logical changes, make multiple commits
- Never `git add -A` without reviewing — stage specific files

### 3. Write the Commit Message

**Format: Conventional Commits**

```
<type>(<scope>): <subject>

<body>
```

**Types:**
| Type | When to use |
|------|-------------|
| `feat` | New feature for the user |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Build process, tooling, dependencies |
| `perf` | Performance improvement |
| `style` | Formatting, whitespace (no code change) |
| `ci` | CI/CD configuration |

**Rules for messages:**
- Subject line: imperative mood, lowercase, no period, under 72 chars
- Body: explain WHY, not WHAT (the diff shows what)
- Reference issues if applicable: `fixes #123`, `closes #456`

**Examples:**
```
feat(auth): add JWT refresh token rotation

Tokens now rotate on each refresh to prevent replay attacks.
The old token is invalidated immediately on use.

Closes #234
```

```
fix(api): handle empty response body from payment provider

The Stripe webhook sometimes sends 204 with no body.
Previously this threw a JSON parse error.
```

### 4. Pre-commit Checks

Before committing, verify:
```bash
# Type check
bun tsc --noEmit  # or equivalent

# Tests
bun test  # or equivalent

# Lint
bun run lint  # if available
```

Only commit if all checks pass.

### 5. Commit

```bash
git commit -m "<message>"
```

Review the commit:
```bash
git log --oneline -3
git show --stat HEAD
```

## Rules

- **One logical change per commit** — don't mix a feature with a refactor
- **No broken commits** — every commit should pass tests
- **No secrets** — check for .env, credentials, API keys before committing
- **Review the diff** — read your own changes before committing
- **Conventional format** — consistent commit messages help with changelogs and git log
- **Don't amend published commits** — only amend if you haven't pushed yet

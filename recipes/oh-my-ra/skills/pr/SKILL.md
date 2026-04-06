---
name: pr
description: Create well-structured pull requests. Reviews all changes, writes clear title and description, and runs pre-PR checks. Use when ready to open a PR.
---

You create clean, reviewable pull requests. You review all changes, write clear descriptions, and ensure the PR is ready for review.

## Process

### 1. Assess the Changes

```bash
# What branch are we on?
git branch --show-current

# What's the base branch?
git log --oneline main..HEAD   # or master, develop

# Full diff against base
git diff main...HEAD --stat
git diff main...HEAD
```

Understand the full scope:
- How many files changed?
- How many commits?
- Is this one logical change or multiple?

### 2. Pre-PR Checks

Run the full verification suite before creating the PR:

```bash
# Type check
bun tsc --noEmit  # or equivalent

# Tests
bun test  # or equivalent

# Lint
bun run lint  # if available

# Build
bun run build  # if applicable
```

**Do not create a PR with failing checks.**

### 3. Clean Up Commits (if needed)

If the commit history is messy:
- Consider squashing fixup commits
- Ensure commit messages are clear and conventional
- Each commit should be a logical unit that passes tests

### 4. Write the PR

**Title:** Short, descriptive, under 72 characters.
- Use conventional format: `feat: add user authentication`
- Don't include ticket numbers in the title (put them in the body)

**Body structure:**

```markdown
## Summary

[1-3 sentences: what changed and why. Link to the issue if applicable.]

Fixes #123

## Changes

- [Bullet list of key changes with file references]
- [Group by logical change, not by file]

## Testing

- [How was this tested?]
- [What test commands were run?]
- [Any manual testing done?]

## Notes for Reviewers

- [Areas that need careful review]
- [Trade-offs made and why]
- [Known limitations or follow-up work]
```

### 5. Create the PR

```bash
# Push the branch
git push -u origin $(git branch --show-current)

# Create PR (adjust base branch as needed)
gh pr create --title "..." --body "..."
```

After creation:
- Review the PR diff on GitHub — does it look right?
- Add labels if applicable
- Request reviewers if you know who should review

## Rules

- **One PR per logical change** — don't bundle unrelated changes
- **All checks must pass** — type check, tests, lint, build
- **Write for the reviewer** — they don't have your context. Explain the "why."
- **Keep PRs small** — under 400 lines of meaningful changes. Split large work into stacked PRs.
- **No commented-out code** — delete it, git remembers
- **No debugging artifacts** — remove console.log, TODO comments you added
- **Review your own diff** — read the full diff before creating. Catch issues a reviewer would.

## Stacked PRs

For large features, create a chain of dependent PRs:

```
PR 1: feat: add user model and database migration (base: main)
PR 2: feat: add user registration API endpoint (base: PR 1 branch)
PR 3: feat: add registration form UI (base: PR 2 branch)
```

Each PR should be independently reviewable and deployable.

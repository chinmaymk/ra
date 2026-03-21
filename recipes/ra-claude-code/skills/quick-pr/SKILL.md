---
name: quick-pr
description: Use when the user asks to create a pull request. Analyzes all branch commits, drafts title and body, pushes with -u flag, and runs gh pr create.
---

When the user asks to create a PR, follow this exact protocol.

## Step 1: Assess (run in parallel)

```bash
git status                          # untracked files (never use -uall)
git diff && git diff --staged       # uncommitted changes
git log --oneline main..HEAD        # all commits on this branch
git diff main...HEAD                # full diff from base branch
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null  # check remote tracking
```

## Step 2: Handle Uncommitted Changes

If there are uncommitted changes, ask the user if they want to commit them first before creating the PR.

## Step 3: Draft PR

Analyze **ALL commits** on the branch, not just the latest one.

- **Title:** Under 70 characters. Use the description/body for details.
- **Body:** Use this format:

```markdown
## Summary
- [1-3 bullet points describing what changed and why]

## Test plan
- [ ] [How to verify the changes work]
```

## Step 4: Push and Create

```bash
# Push with tracking (create branch if needed)
git push -u origin <branch-name>

# Create PR using HEREDOC for body
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
- bullet points here

## Test plan
- [ ] verification steps here
EOF
)"
```

## Rules

- **Never push to main/master** without explicit permission
- **Push with `-u` flag** to set upstream tracking
- Use `gh pr create` — not the GitHub web interface
- Analyze the full branch diff, not just the last commit
- If the base branch is unclear, ask the user

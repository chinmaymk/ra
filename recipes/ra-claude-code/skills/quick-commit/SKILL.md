---
name: quick-commit
description: Streamlined git commit workflow. Assesses changes, drafts a message, stages specific files, and commits — following Claude Code's exact git protocol.
---

When the user asks to commit, follow this exact protocol.

## Step 1: Assess (run in parallel)

```bash
git status                    # untracked and modified files (never use -uall)
git diff && git diff --staged # both staged and unstaged changes
git log --oneline -5          # recent commit style
```

## Step 2: Draft Message

- Summarize the nature: `feat:` (new), `fix:` (bug), `refactor:`, `test:`, `docs:`, `chore:`
- Focus on **why**, not what
- Match the repo's existing commit style
- Concise: 1-2 sentences
- Do NOT commit files that likely contain secrets (`.env`, `credentials.json`, etc.)

## Step 3: Stage and Commit

- **Stage specific files by name** — never `git add -A` or `git add .`
- Create the commit using HEREDOC format:
```bash
git commit -m "$(cat <<'EOF'
feat: add user authentication with JWT

EOF
)"
```
- Run `git status` after commit to verify success

## Step 4: Handle Pre-Commit Hook Failures

If a pre-commit hook fails:
1. The commit did NOT happen
2. Fix the issue (lint error, type error, etc.)
3. Re-stage the fixed files
4. Create a **NEW** commit — do NOT use `--amend` (that would modify the previous commit)

## Rules

- **Only commit when explicitly asked**
- **Never** use `--no-verify` to skip hooks
- **Never** update git config
- **Never** use `-i` flag (interactive mode not supported)
- Warn the user if they ask to commit files that look like secrets

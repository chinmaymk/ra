---
name: git-workflow
description: Use for any git operation — branching, merging, rebasing, conflict resolution, or understanding git state. Defines safety rules for destructive commands.
---

You handle all git operations with extreme care. Git mistakes can lose work.

## Safety Protocol

**NEVER without explicit user request:**
- Update git config
- Run destructive commands: `push --force`, `reset --hard`, `checkout .`, `restore .`, `clean -f`, `branch -D`
- Skip hooks: `--no-verify`, `--no-gpg-sign`
- Force push to main/master (warn even if requested)
- Commit changes (only commit when explicitly asked)

**ALWAYS:**
- Create NEW commits rather than amending (unless explicitly asked)
- Stage specific files by name (not `git add -A` or `git add .`)
- Check `git status` and `git diff` before committing
- Review what you're about to push before pushing

## Commit Workflow

When asked to commit:

1. **Assess** (in parallel):
   - `git status` — see untracked and modified files
   - `git diff` and `git diff --staged` — see actual changes
   - `git log --oneline -5` — recent commit style

2. **Draft message:**
   - Summarize the nature: new feature, enhancement, bug fix, refactor, test, docs
   - Focus on "why" not "what"
   - Match the repo's existing commit message style
   - Use conventional commits if the repo does: `feat:`, `fix:`, `refactor:`, etc.

3. **Stage and commit:**
   - Add specific files (never secrets like `.env`, credentials)
   - Create the commit

4. **If pre-commit hook fails:**
   - Fix the issue
   - Create a NEW commit (don't amend — the failed commit didn't happen)

## PR Workflow

When asked to create a PR:

1. **Assess** (in parallel):
   - `git status` — untracked files
   - `git diff` — uncommitted changes
   - `git log base..HEAD` — all commits in the branch
   - Check if branch tracks remote

2. **Create PR:**
   - Title under 70 characters
   - Body with: Summary (1-3 bullets), Test plan (checklist)
   - Push with `-u` flag if needed
   - Use `gh pr create`

## Conflict Resolution

- **Prefer resolving** over discarding changes
- Read both sides of the conflict to understand intent
- If unclear, ask the user which version to keep
- After resolving, run tests to verify nothing broke

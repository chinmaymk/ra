---
name: ultrawork
description: Full autonomous pipeline for complex tasks. Combines clarification, planning, parallel execution, verification, and self-review into a single end-to-end workflow. Use for ambitious multi-step tasks.
---

You are in ultrawork mode — a fully autonomous pipeline that takes a complex task from ambiguity to verified completion. You combine all your skills into a structured workflow.

## Pipeline

Execute these phases in order. Each phase has a gate — only proceed if the gate passes.

### Phase 1: Clarify (30 seconds max)

Quick-scan for ambiguity. This is NOT a full interview — just catch critical unknowns.

- Read relevant files to understand the current state
- If the task is clear enough to proceed → skip to Phase 2
- If there are 1-2 critical unknowns → ask the user (max 3 questions with defaults)
- If the user said "just do it" → proceed with reasonable defaults, state your assumptions

**Gate:** You have enough clarity to write a plan.

### Phase 2: Plan

Create a concrete, step-by-step plan. Save it to the scratchpad.

```
## Plan: [task summary]

Steps:
1. [action] — verify: [how to confirm]
2. [action] — verify: [how to confirm]
...

Risks:
- [potential issue and mitigation]
```

For tasks with independent parts, identify which steps can be parallelized.

**Gate:** Plan has concrete steps with verification methods.

### Phase 3: Execute

Work through the plan systematically.

- **Sequential steps** — execute one at a time, verify each before moving on
- **Parallel steps** — use Agent tool to run independent work simultaneously
- **Update the plan** — mark steps complete in the scratchpad as you go
- **Adapt** — if a step fails or reveals new information, update the plan

During execution:
- Read before writing
- Make minimal changes
- Run tests after each meaningful change
- Fix failures immediately — don't accumulate debt

**Gate:** All plan steps are complete and individually verified.

### Phase 4: Verify

Run the full verification suite:

1. **Type check** — `tsc`, `mypy`, `pyright`, etc.
2. **Lint** — project's lint command
3. **Tests** — full test suite, not just the tests you wrote
4. **Build** — if the project has a build step

Discover the right commands from `package.json`, `Makefile`, etc. — don't guess.

**Gate:** All checks pass. "Almost passing" is not passing.

### Phase 5: Self-Review

Review your own work with critical eyes:

- Re-read every file you modified
- Check for: bugs, edge cases, security issues, unnecessary complexity
- Verify the changes actually solve the original task
- Look for anything you forgot

If you find issues, fix them and re-verify (back to Phase 4).

**Gate:** No critical issues found. Changes are correct, secure, and minimal.

### Phase 6: Report

Summarize what was done:

```
## Done: [task summary]

### Changes
- [file:line] [what changed and why]

### Verification
- Type check: ✓
- Tests: X/X passing
- Build: ✓

### Notes
- [Anything the user should know — trade-offs made, follow-up items, etc.]
```

## Rules

- **Don't skip phases** — even if the task seems simple, at least quick-scan each phase
- **Don't get stuck in clarification** — if you have enough to start, start
- **Adapt the plan** — a plan that doesn't survive contact with reality should be updated, not abandoned
- **Verify everything** — the whole point of this pipeline is catching issues before the user sees them
- **Be honest in self-review** — finding your own bugs is a feature, not a failure
- **One pipeline at a time** — don't nest ultrawork inside ultrawork

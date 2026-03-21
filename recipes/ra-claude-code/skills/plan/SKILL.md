---
name: plan
description: Use when a task has 5+ steps, spans multiple files, or requires architectural decisions. Creates a plan, saves it to the scratchpad, and waits for user approval before starting implementation.
---

You are in plan mode. Your job is to think through the approach and produce a clear plan — **not to implement anything yet**.

## Rules

1. **Do NOT start implementation.** No file edits, no writes, no tool calls that change state. Read-only research is fine (Read, Glob, Grep, Bash for inspecting).
2. **Save the plan to the scratchpad** using `scratchpad_write` with key `"plan"` so it survives compaction.
3. **Ask the user to approve** before proceeding. Say something like: "Here's the plan. Want me to go ahead?"
4. **Only after explicit approval** ("yes", "go", "do it", "approved", etc.) should you begin executing.

## When to Plan

- **Skip:** Simple tasks — renaming, fixing a typo, adding a small function. Just do it.
- **Light plan:** Medium tasks — adding a feature, fixing a non-trivial bug. 3-5 steps.
- **Full plan:** Complex tasks — new systems, major refactors, multi-file changes. 5-8 steps.

## Planning Process

1. **Understand the goal** — restate it in one sentence
2. **Map what exists** — read relevant files, understand current architecture
3. **Identify steps** — each step should be concrete, small, testable
4. **Order by dependency** — front-load the riskiest step
5. **Call out risks** — what might go wrong? What's out of scope?

## Step Characteristics

Each step should be:
- **Concrete** — names specific files, functions, or commands
- **Small** — completable in one focused pass
- **Testable** — has a verification method (run test, type-check, manual check)

## Output Format

Present the plan to the user, then save it to the scratchpad:

```
Goal: [one sentence]

Steps:
1. [action] — verify: [how to confirm it worked]
2. [action] — verify: [how to confirm it worked]
...

Risks:
- [what might go wrong and mitigation]

Out of scope:
- [explicit non-goals]
```

Then call `scratchpad_write` with key `"plan"` and the plan text as value.

## During Execution (after approval)

- Update the plan in the scratchpad as you complete steps (mark done with `[x]`)
- If a step fails, reassess the plan rather than blindly continuing
- If the plan needs to change significantly, tell the user and get re-approval

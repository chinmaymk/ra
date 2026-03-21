---
name: todo
description: Track tasks during multi-step work. Each task is a separate scratchpad entry so updates are atomic and nothing gets dropped.
---

You are managing a todo list. Each task is stored as a separate scratchpad entry so individual updates never clobber other items.

## Format

Each task is a scratchpad key `todo#N` with a value like:

```
[ ] Fix auth middleware
[x] Add rate limiting
```

## Operations

**Add a task:** Write the next available number — `scratchpad_write("todo#1", "[ ] Fix auth middleware")`.

**Complete a task:** Overwrite it — `scratchpad_write("todo#3", "[x] Add rate limiting")`.

**Remove a task:** Delete it — `scratchpad_delete("todo#3")`. Gaps in numbering are fine.

## Rules

- After completing a task, update the scratchpad immediately. Don't batch.
- Always show the current task list to the user after any update.
- When all tasks are done, summarize what was accomplished and delete all `todo#*` keys.
- Keep descriptions short and actionable — "Fix auth middleware timeout" not "Look into the authentication middleware because it might have a timeout issue".
- If a task is more complex than expected, add new `todo#N` entries for sub-tasks.

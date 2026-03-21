---
name: todo
description: Use when managing a task list — tracking multiple steps, checking off progress, or organizing work items. Persists the list in the scratchpad so it survives compaction.
---

You are managing a todo list. Use the scratchpad to track tasks so progress survives context compaction.

## Format

Store the list in the scratchpad under key `"todo"` using this format:

```
- [ ] Task description
- [ ] Task description
- [x] Completed task
```

## Operations

**Create/replace the list:**
Call `scratchpad_write` with key `"todo"` and the full markdown checklist.

**Update progress:**
Read the current list from scratchpad context, mark items `[x]` as you complete them, then write the updated list back with `scratchpad_write`.

**Add items:**
Append new `- [ ]` lines to the existing list and write it back.

**Remove items:**
Delete completed or cancelled lines and write the updated list back.

## Rules

- Always use key `"todo"` in the scratchpad — one list per session.
- After completing a task, immediately update the scratchpad. Don't batch updates.
- When all items are done, summarize what was accomplished and delete the key with `scratchpad_delete`.
- Keep descriptions short and actionable — "Fix auth middleware timeout" not "Look into the authentication middleware because it might have a timeout issue".
- If a task turns out to be more complex than expected, break it into sub-tasks inline.

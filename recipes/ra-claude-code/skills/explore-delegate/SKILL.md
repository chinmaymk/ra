---
name: explore-delegate
description: Use when you need to search broadly across a codebase, explore multiple areas simultaneously, or parallelize independent research tasks using the Agent tool.
---

You can spawn subagents using the `Agent` tool to handle tasks in parallel or to protect your context window from large results.

## When to Delegate

**Use a subagent when:**
- Searching broadly across a codebase (e.g., "find all API endpoints")
- The search might require multiple rounds of glob/grep to find the right files
- You need to explore multiple independent areas simultaneously
- The result would flood your context (reading 10+ files)
- You want to parallelize independent research tasks

**Don't delegate when:**
- You know the exact file path — just use `Read`
- You're searching for a specific class/function name — just use `Grep` or `Glob`
- The task is 1-2 simple searches — do it yourself, it's faster

## Exploration Agent Pattern

For broad codebase exploration, spawn a read-only agent:

```
Agent: "Find all files that handle authentication in this codebase. Check src/, lib/, and app/ directories. Look for middleware, route handlers, and utility functions related to auth, login, session, token, or JWT. Return a list of files with a one-line description of what each does."
```

Key principles for explore agents:
- **Start broad, narrow down** — search multiple locations and naming conventions
- **Read-only** — explore agents should never modify files
- **Return structured results** — ask for file paths and summaries, not raw content

## Parallel Research Pattern

When you need to understand multiple independent things:

```
# Launch in parallel:
Agent 1: "How does the database connection pool work? Read the relevant files and summarize."
Agent 2: "What test framework is used? Find the test config and example tests."
Agent 3: "What's the deployment process? Check CI/CD configs and scripts."
```

## Planning Agent Pattern

For complex architectural decisions:

```
Agent: "Analyze the current auth system in src/auth/. I need to add OAuth2 support. Read the existing code, identify integration points, and suggest an approach with specific files to modify."
```

## Rules

- Give agents **complete, self-contained prompts** — they don't share your context
- Specify **what to return** — "return file paths and summaries" vs. "return full file contents"
- Don't duplicate work — if you delegate, don't also search yourself
- Launch independent agents **in parallel** for best performance
- Agents are expensive — don't spawn one for a simple grep

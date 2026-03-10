---
name: verify
description: Use before claiming work is complete, before committing, or before creating a PR.
---

# Verification Checklist

Run these before saying "done." No exceptions.

## Steps

1. **Type check** — `bun tsc`
   - Must pass with zero errors
   - Don't use `as any` to silence errors — fix the types

2. **Tests** — `bun test`
   - All existing tests must pass
   - New code needs tests in `tests/` mirroring `src/` structure
   - Bug fixes need a regression test

3. **Smoke test** — run the actual thing
   - Providers: `bun run ra --provider <name> "Hello"`
   - Tools: `bun run ra "Use <tool> to ..."`
   - Interfaces: start the interface, exercise the happy path
   - Skills: `bun run ra --skill <name> "Test prompt"`
   - Recipes: `cd recipes/<name> && ra --config ra.config.yaml "test prompt"`

4. **Review diff** — `git diff`
   - No debug logs
   - No commented-out code
   - No unrelated changes
   - No secrets or hardcoded keys
   - No `as any` casts

## Common Mistakes

- Claiming "tests pass" without running `bun test`
- Skipping `bun tsc` ("it runs" != "it type-checks")
- Not testing the user-facing flow end-to-end
- Forgetting to check for regressions in adjacent features
- Leaving `console.log` debugging statements in

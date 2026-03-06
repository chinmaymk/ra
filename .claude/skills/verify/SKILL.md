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
   - New code should have tests in `tests/` mirroring the `src/` structure
   - If you fixed a bug, add a test that reproduces it

3. **Smoke test** — Run the actual thing
   - For providers: `bun run ra --provider <name> "Hello"`
   - For tools: `bun run ra "Use <tool> to ..."`
   - For interfaces: start the interface and exercise the happy path
   - For skills: `bun run ra --skill <name> "Test prompt"`

4. **Review your diff** — `git diff`
   - No debug logs left in
   - No commented-out code
   - No unrelated changes
   - No secrets or hardcoded keys

## Common Mistakes

- Claiming "tests pass" without running them
- Skipping type check ("it runs fine" ≠ "it type-checks")
- Not testing the actual user-facing flow end-to-end
- Forgetting to check for regressions in adjacent features

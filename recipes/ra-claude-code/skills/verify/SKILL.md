---
name: verify
description: Use after making code changes, before committing, or before claiming work is done. Runs type-check → lint → test → build and fixes failures immediately.
---

You verify your work before claiming it's done. Never say "the changes are complete" without evidence.

## When to Verify

- **After every meaningful code change** — run the relevant test suite
- **Before committing** — type-check and lint
- **After fixing a bug** — run the failing test, then the full suite
- **After refactoring** — run the full suite to catch regressions

## Verification Steps

Run these in order. Stop on first failure and fix before continuing.

### 1. Type Check (if applicable)
```bash
# TypeScript
bun tsc --noEmit
# or npx tsc --noEmit

# Python
mypy . || pyright .
```

### 2. Lint
```bash
# Check package.json scripts for lint command
# Common: bun run lint, npm run lint, cargo clippy, go vet
```

### 3. Tests
```bash
# Check package.json scripts for test command
# Common: bun test, npm test, cargo test, go test ./..., pytest
```

### 4. Build (if the project has a build step)
```bash
# Common: bun run build, npm run build, cargo build
```

## Rules

- **Discover the right commands first.** Read `package.json`, `Makefile`, `Cargo.toml`, etc. Don't guess.
- **Run the narrowest test first.** If you changed `foo.ts`, run `foo.test.ts` before the full suite.
- **Read the full output.** Don't just check exit code — read error messages, warnings, and failed test names.
- **Fix failures immediately.** Don't report them to the user and wait. Fix them, then verify again.
- **"Almost passing" is not passing.** 99/100 tests passing means it's broken.
- **Don't skip verification** because "the change is small." Small changes cause big bugs.

## When Verification is Blocked

If the project has no tests, no type-checker, and no linter:
1. Do a manual review — re-read your changes for obvious errors
2. Trace the logic mentally with example inputs
3. Tell the user verification is limited and suggest adding tests

## Output

After verification, summarize briefly:
```
Type check: pass
Lint: pass
Tests: 42/42 passing
```

Or if something failed:
```
Tests: 41/42 passing — `test_auth_flow` failing (assertion error on line 58)
Fixing...
```

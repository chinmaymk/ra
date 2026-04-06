---
name: stuck
description: Recovery skill for when you're going in circles. Use when the same approach keeps failing, errors repeat, or progress has stalled. Breaks the loop with systematic reframing.
---

You are stuck. Something isn't working, and you've tried the obvious approaches. Time to break the loop with a systematic recovery process.

## Trigger Conditions

Activate this skill when you notice:
- You've tried the same fix more than twice
- The same error keeps appearing after different "fixes"
- You're making changes without understanding why they might work
- You've been working on the same issue for 5+ iterations without progress
- You're adding complexity (try/catch, null checks, type casts) to work around a problem

## Recovery Process

### Step 1: Stop and Document

Stop trying to fix things. Write down the current state:

```
## Stuck Report

### What I'm trying to do
[Original goal in one sentence]

### What's happening
[Exact error, unexpected behavior, or failure]

### What I've tried
1. [Approach 1] → [Result]
2. [Approach 2] → [Result]
3. [Approach 3] → [Result]

### What I assumed
- [Assumption 1 — is this actually true?]
- [Assumption 2 — have I verified this?]
```

### Step 2: Challenge Assumptions

Go through each assumption and verify it:

- **Is the function actually being called?** Add a log at the entry point.
- **Is the data what I think it is?** Log the actual value, don't assume.
- **Am I looking at the right file?** Check that the running code matches what you're reading.
- **Is the test actually testing what I think?** Read the assertion carefully.
- **Am I solving the right problem?** Re-read the original request.

### Step 3: Simplify

- **Minimal reproduction**: Can you reproduce the issue in 10 lines?
- **Remove variables**: Comment out everything non-essential. Does the core behavior work?
- **Start from known-good**: Find the last state where things worked (git log). What changed?

### Step 4: Reframe

Try a completely different angle:

| If you're stuck on... | Try... |
|----------------------|--------|
| A runtime error | Reading the source of the library throwing it |
| A type error | Looking at the type definitions, not just the usage |
| A test failure | Running just that one test with verbose output |
| An integration issue | Testing each component in isolation |
| "It should work" | Accepting it doesn't and looking at what IS happening |
| A complex fix | Asking "is there a simpler way to achieve the same goal?" |

### Step 5: Decide

After reframing, choose one of:

1. **New approach** — I now see a different path. Describe it, then try it.
2. **Need more info** — I need to understand [specific thing] before proceeding. Research it.
3. **Ask the user** — I've exhausted what I can try. Ask the user with full context of what you've tried.
4. **Scope reduction** — The original goal is too ambitious. Propose a simpler version.

## Rules

- **Never try the same thing twice** — if it didn't work, understand WHY before trying a variation
- **Log before guessing** — verify your mental model matches reality
- **Admit when stuck** — asking the user with good context is better than spinning in circles
- **Don't add complexity** — if the fix requires 3 workarounds, the approach is wrong
- **Time-box yourself** — if step 4 doesn't produce a new idea within 2 iterations, go to the user

---
name: stuck-recovery
description: Use when the same error appears 3+ times, you're retrying commands with minor variations, or making no progress on a sub-problem. Forces a strategy change.
---

You monitor your own progress. When you're stuck, you recognize it and change approach.

## Signs You're Stuck

- Same error appearing 3+ times in a row
- Retrying the same command with minor variations
- Going back and forth between two states
- Making changes that keep getting reverted by tests/linting
- Spending more than 5 iterations on a single sub-problem

## Recovery Protocol

When you detect you're stuck:

### 1. Stop and Acknowledge
Don't try one more time. Stop. Tell the user:
```
I'm stuck on [specific problem]. I've tried [approaches]. Let me step back.
```

### 2. Re-read the Error
Read the **full** error message again. Not just the last line — the entire stack trace, including:
- The actual error type/code
- The file and line number
- The chain of calls that led here
- Any "caused by" or nested errors

### 3. Challenge Your Assumptions
Ask yourself:
- Am I editing the right file? (Maybe there's a compiled/cached version)
- Am I looking at the right error? (Maybe the real failure is earlier in the output)
- Is my mental model correct? (Re-read the relevant code from scratch)
- Am I fighting the framework? (Maybe there's an idiomatic way to do this)
- Is there a version mismatch? (Check dependency versions)

### 4. Try a Different Approach

Pick one:
- **Simplify:** Create a minimal reproduction. Strip away everything non-essential.
- **Bisect:** Comment out half the code. Does the error persist? Narrow from there.
- **Read the docs:** Search for the error message. Check the library's README, issues, or changelog.
- **Start over:** If your approach is fundamentally wrong, undo and try a completely different strategy.
- **Ask the user:** "I'm stuck on X. I've tried A and B. Do you have any insight into this?"

### 5. If Still Stuck After Recovery

Summarize clearly:
```
Problem: [what's failing]
Tried: [list of approaches]
Root cause: [best guess]
Suggestion: [what might work, or what info is needed]
```

Then ask the user for direction. Don't keep spinning.

## Prevention

- Don't guess-and-check. Understand before changing.
- Read error messages fully the first time.
- Test one change at a time.
- If a fix feels hacky, it probably is — find the real cause.

# CLI (One-Shot)

Run a prompt, stream output, exit. No state, no sessions — just input → output.

```bash
ra "What is the capital of France?"
```

Useful for scripting, piping, and cron jobs.

## Common flags

```bash
ra --provider openai --model gpt-4.1-mini "Explain this"
ra --file report.pdf "Summarize in three bullets"
ra --skill code-review --file diff.patch "Review this diff"
ra --system-prompt "You are a JSON extractor. Output only JSON." "Extract fields from: ..."
```

## Piping

```bash
# Summarize a log file
cat error.log | ra "What is causing this error?"

# Review a diff
git diff | ra --skill code-review "Review this diff"
```

## Exit codes

- `0` — success
- non-zero — error (provider failure, config error, etc.)

# CLI (One-Shot)

Run a prompt, stream output, exit. The default mode when you pass a prompt.

```bash
ra "What is the capital of France?"
```

## Common flags

```bash
ra --provider openai --model gpt-4.1-mini "Explain this"
ra --file report.pdf "Summarize in three bullets"
ra --skill code-review --file diff.patch "Review this diff"
ra --system-prompt "You are a JSON extractor. Output only JSON." "Extract fields from: ..."
ra --thinking high "Design a distributed cache"
```

## Piping

When input is piped, ra reads stdin and auto-switches to CLI mode. The piped content becomes part of the prompt.

```bash
cat error.log | ra "What is causing this error?"
git diff | ra --skill code-review "Review this diff"
git diff | ra "Summarize these changes"
echo "hello world" | ra                             # stdin becomes the prompt
```

## Chaining

Chain ra commands together for multi-step workflows:

```bash
ra "List all TODO comments" | ra "Group by priority and format as a table"
```

## File attachments

Attach images, PDFs, and text files with `--file`:

```bash
ra --file screenshot.png "What's wrong with this UI?"
ra --file report.pdf --file data.csv "Summarize both files"
```

## Resuming sessions

When the agent calls `ask_user`, the session ID is printed to stderr so you can resume later:

```bash
ra --resume <session-id> "Continue from where we left off"
```

## Exit codes

- `0` — success
- non-zero — error (provider failure, config error, etc.)

# CLI (One-Shot)

Run a prompt, stream the response, exit. This is the default mode when you pass a prompt on the command line.

```bash
ra "What is the capital of France?"
```

ra streams the model's response to stdout, executes any tool calls the model makes, and exits when the agent loop completes.

## Common flags

```bash
ra --provider openai --model gpt-4.1-mini "Explain this"
ra --file report.pdf "Summarize in three bullets"
ra --skill code-review --file diff.patch "Review this diff"
ra --system-prompt "You are a JSON extractor. Output only JSON." "Extract fields from: ..."
ra --thinking adaptive "Design a distributed cache"
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

See [File Attachments](/core/file-attachments) for supported formats and provider compatibility.

## Resuming sessions

Resume the most recent session:

```bash
ra --resume "Continue from where we left off"
```

Resume a specific session by ID:

```bash
ra --resume=<session-id> "Continue from where we left off"
```

See [Sessions](/core/sessions) for more on session persistence.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| Non-zero | Error (provider failure, config error, etc.) |

## Inspect configuration

Show the resolved configuration or discovered context files without starting the agent:

```bash
ra --show-config
ra --show-config --provider openai --model gpt-4.1
ra --show-context
```

See [Configuration](/configuration/#show-config) for details.

## See also

- [REPL](/modes/repl) — for interactive sessions
- [Configuration](/configuration/) — all CLI flags and their config equivalents
- [Recipes](/recipes/) — piping and chaining patterns

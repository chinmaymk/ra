# File Attachments

Attach images, PDFs, and text files to any prompt. ra detects the MIME type and sends the content in the right format for each provider.

## CLI

Use the `--file` flag. Multiple files can be attached:

```bash
ra --file screenshot.png "What's wrong with this UI?"
ra --file report.pdf --file data.csv "Summarize both files"
ra --file architecture.png --file spec.md "Does the implementation match the spec?"
```

## REPL

Use `/attach` to add files to your next message:

```
› /attach architecture.png
› /attach requirements.md
› How should we refactor this?
```

Attached files are sent with the next message you type, then cleared.

## Supported formats

ra detects the MIME type automatically and sends files in the format each provider expects.

| Format | How it's sent | Notes |
|--------|--------------|-------|
| **Images** (PNG, JPG, GIF, WebP) | Vision content block | Requires a vision-capable model |
| **PDFs** | Document content block | Sent as base64 |
| **Text files** (`.ts`, `.md`, `.json`, etc.) | Inlined as text | Content included directly in the message |
| **Other** | Inlined as text | Best-effort text extraction |

## Provider support

All providers support text file attachments. Image and PDF support varies:

| Provider | Images | PDFs |
|----------|--------|------|
| Anthropic | Yes | Yes |
| OpenAI | Yes | No (inlined as text) |
| Google | Yes | Yes |
| Azure | Yes | No (inlined as text) |
| Bedrock | Yes | Yes |
| Ollama | Depends on model | No |

## See also

- [CLI](/modes/cli) — `--file` flag usage
- [REPL](/modes/repl) — `/attach` command
- [Pattern Resolution](/core/context-control#pattern-resolution) — inline `@file` references as an alternative

# Quick Start

Set your provider key and go:

```bash
export RA_ANTHROPIC_API_KEY="sk-..."
```

## One-shot — streams to stdout and exits

```bash
ra "Summarize the key points of this file" --file report.pdf
```

## Interactive REPL

```bash
ra
```

## HTTP API server

```bash
ra --http
```

## MCP server for Cursor / Claude Desktop

```bash
ra --mcp
```

## More examples

```bash
# Code review with a skill and file attachment
ra --skill code-review --file diff.patch "Review this diff"

# Use a different provider
ra --provider openai --model gpt-4.1 "Explain this error"

# Enable extended thinking
ra --thinking high "Design a distributed cache"
```

## Next steps

- [Configure a provider](/providers/anthropic) — set your API key
- [Learn the interfaces](/modes/cli) — CLI, REPL, HTTP, MCP
- [Explore layered config](/concepts/config) — file → env → CLI

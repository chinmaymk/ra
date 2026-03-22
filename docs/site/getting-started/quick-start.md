# Quick Start

Set your provider key and go:

```bash
export ANTHROPIC_API_KEY="sk-..."
```

## One-shot — streams to stdout and exits

```bash
ra "Summarize the key points of this file" --file report.pdf
```

## Pipe stdin

```bash
cat error.log | ra "Explain this error"
git diff | ra --skill code-review "Review these changes"
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
ra --mcp-stdio
```

## More examples

```bash
# Code review with a skill and file attachment
ra --skill code-review --file diff.patch "Review this diff"

# Use a different provider
ra --provider openai --model gpt-4.1 "Explain this error"

# Enable extended thinking
ra --thinking high "Design a distributed cache"

# Reference files inline
ra "explain what @src/auth.ts does"
```

## Next steps

- [The Agent Loop](/core/agent-loop) — understand how ra works
- [Context Control](/core/context-control) — compaction, thinking, pattern resolution
- [Configure a provider](/providers/anthropic) — set your API key
- [Learn the interfaces](/modes/cli) — CLI, REPL, HTTP, MCP
- [Configuration reference](/configuration/) — all fields, env vars, CLI flags

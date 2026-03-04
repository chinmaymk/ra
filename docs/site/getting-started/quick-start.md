# Quick Start

## One-off question

```bash
ra "What is the capital of France?"
```

Streams to stdout and exits.

## Pick a provider and model

```bash
ra --provider openai --model gpt-4.1-mini "Explain this error"
```

## Attach a file

```bash
ra --file report.pdf "Summarize in three bullets."
```

## Inject a skill

```bash
ra --skill code-review --file diff.patch "Review this diff."
```

## Start the REPL

```bash
ra
```

You get a `›` prompt. Type. It streams back, runs tools, saves the conversation.

## Next steps

- [Configure a provider](/providers/anthropic) — set your API key
- [Learn the modes](/modes/cli) — CLI, REPL, HTTP, MCP
- [Explore layered config](/concepts/config) — file → env → CLI

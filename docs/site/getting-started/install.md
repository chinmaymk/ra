# Install

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
```

This downloads the latest compiled binary and places it in your `PATH`.

Verify the installation:

```bash
ra --help
```

## Manual install

If you already have the binary:

```bash
mv ra /usr/local/bin/ra && chmod +x /usr/local/bin/ra
```

## Build from source

Requires [Bun](https://bun.sh) (v1.0+).

```bash
git clone https://github.com/chinmaymk/ra
cd ra
bun install
bun run compile   # → dist/ra
```

The compiled binary is at `dist/ra`. Copy it to your `PATH` or run it directly.

## GitHub Actions

Use ra directly in CI/CD workflows — no install step needed:

```yaml
- uses: chinmaymk/ra@v0.1.0
  with:
    prompt: "Review this PR for bugs and security issues"
  env:
    RA_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

See [GitHub Actions](/modes/github-actions) for all inputs, outputs, and examples.

## Set up a provider

ra needs at least one LLM provider configured. The fastest way to get started:

```bash
export RA_ANTHROPIC_API_KEY="sk-ant-..."
ra "Hello"
```

See [Providers](/providers/anthropic) for all supported providers and their configuration.

## Next steps

- [Quick Start](/getting-started/quick-start) — common usage patterns
- [What is ra?](/concepts/) — understand the architecture

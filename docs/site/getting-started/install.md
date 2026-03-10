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

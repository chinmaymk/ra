# Install

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
```

Or manually:

```bash
mv ra /usr/local/bin/ra && chmod +x /usr/local/bin/ra
```

Verify:

```bash
ra --help
```

## Build from source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/chinmaymk/ra
cd ra
bun install
bun build src/index.ts --compile --target bun --outfile dist/ra
# Binary is at dist/ra
```

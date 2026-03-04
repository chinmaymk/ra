# Install

Grab the `ra` binary for your OS. Put it somewhere on your `PATH`. Done.

```bash
mv ra /usr/local/bin/ra
chmod +x /usr/local/bin/ra
ra --help
```

If `ra --help` prints something, you're in.

## From source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/chinmaymk/ra
cd ra
bun install
bun run compile
# outputs dist/ra
```

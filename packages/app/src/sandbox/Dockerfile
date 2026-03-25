FROM oven/bun:1 AS base
WORKDIR /app

# Copy workspace package files for dependency resolution
COPY package.json bun.lock ./
COPY packages/ra/package.json packages/ra/
COPY packages/app/package.json packages/app/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY packages/ra/ packages/ra/
COPY packages/app/ packages/app/

# Entry point: sandbox-entry.ts reads NDJSON from stdin, writes to stdout
ENTRYPOINT ["bun", "run", "packages/app/src/sandbox/sandbox-entry.ts"]

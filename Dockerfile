# Stage 1: Install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Stage 2: Build binary
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun build src/index.ts --compile --target bun --outfile dist/ra

# Stage 3: Production image
FROM ubuntu:24.04 AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN groupadd --gid 1001 ra && \
    useradd --uid 1001 --gid ra --shell /bin/false --create-home ra

WORKDIR /app

COPY --from=build /app/dist/ra /app/ra

# Create storage directory
RUN mkdir -p /app/data && chown ra:ra /app/data

USER ra

ENV NODE_ENV=production
ENV RA_LOG_FORMAT=json
ENV RA_STORAGE_PATH=/app/data/sessions
ENV RA_INTERFACE=http
ENV RA_HTTP_PORT=3000

EXPOSE 3000 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/ra", "--exec", "/app/healthcheck.js"]

ENTRYPOINT ["/app/ra"]
CMD ["--http"]

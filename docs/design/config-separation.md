# Config Separation: Independent `app.yml` + `agent.yml`

## Context

`RaConfig` is a flat interface mixing app deployment, agent behavior, and credentials. No composable agent config type exists in the core library. Recipes mix concerns. We want clean separation with independent files.

## What We're Doing

1. **`agent.yml`** — agent behavior config. Owned by `packages/ra` as `AgentConfig` type. Portable, composable. A recipe IS an agent.yml.
2. **`app.yml`** — deployment config. Owned by `packages/app` as `AppConfig` type. Environment-specific.
3. **Global + local config roots** — layered config loading from well-known directories.
4. **`mergeAgentConfig()`** — compose agent configs for layering/overrides.
5. Remove `skills` from config (loaded from prompt).

## Config Roots — Global + Local

Two config root levels, merged in order (later wins):

### Global config root: `~/.config/ra/`

User-level defaults across all projects. Good for default provider, credentials, personal preferences.

```
~/.config/ra/
  agent.yml       # default agent behavior
  app.yml         # default app settings (provider credentials, log level, etc.)
```

### Local config root: `.ra/config/` (discovered by upward search)

Project-level config. Discovered by searching upward from cwd for a `.ra/` directory, then loading from `.ra/config/` inside it.

```
project/
  .ra/
    config/
      agent.yml   # project-specific agent config
      app.yml     # project-specific app settings
    sessions/     # data (unchanged)
    memory/       # data (unchanged)
```

### Explicit override: `--config <dir>`

Overrides both global and local. Points to any directory containing config files.

```bash
bun run ra --config ./recipes/coding-agent/    # use recipe's config dir
```

Or env var: `RA_CONFIG_DIR=./recipes/coding-agent/`

### Merge order

```
global (~/.config/ra/)
  → local (.ra/config/, discovered upward)
    → explicit (--config dir)
      → env vars (RA_*)
        → CLI flags (--model, --provider, etc.)
```

Each layer only overrides fields it sets. Missing files at any layer = skip that layer.

### Discovery algorithm

```
1. Load global: ~/.config/ra/{agent,app}.yml
2. Search upward from cwd for .ra/ directory
   - If found: load .ra/config/{agent,app}.yml
3. If --config flag: load <dir>/{agent,app}.yml (overrides local)
4. Apply env vars
5. Apply CLI flags
6. Return merged RaConfig { app, agent }
```

## File Format

**`agent.yml`** (this IS a recipe):
```yaml
provider: anthropic
model: claude-opus-4-6
thinking: high
maxIterations: 200

tools:
  builtin: true

middleware:
  afterModelResponse:
    - ./middleware/token-budget.ts

compaction:
  enabled: true
  threshold: 0.8

mcp:
  client:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
```

**`app.yml`**:
```yaml
interface: repl
dataDir: .ra
skillDirs:
  - ./skills
logsEnabled: true
logLevel: info
http:
  port: 3001
```

## Type Design

### `AgentConfig` — `packages/ra/src/agent/config.ts` (NEW)

```typescript
export interface AgentConfig {
  provider: ProviderName
  model: string
  systemPrompt?: string
  thinking?: 'low' | 'medium' | 'high'

  // Non-secret provider options (baseURL, region, deployment)
  providerOptions?: Record<string, Record<string, unknown>>

  maxIterations?: number
  maxRetries?: number
  toolTimeout?: number
  maxConcurrency?: number

  tools?: {
    builtin?: boolean
    overrides?: Record<string, ToolSettings>
    maxResponseSize?: number
  }

  permissions?: PermissionsConfig
  middleware?: Record<string, string[]>
  compaction?: CompactionConfig

  memory?: {
    enabled?: boolean
    maxMemories?: number
    ttlDays?: number
    injectLimit?: number
  }

  context?: ContextConfig

  mcp?: {
    client?: McpClientConfig[]
    lazySchemas?: boolean
  }
}

export const defaultAgentConfig: AgentConfig = { /* ... */ }

/** Deep-merge agent configs. Scalars: last-write-wins. Arrays: concat. Objects: shallow merge. */
export function mergeAgentConfig(
  base: AgentConfig,
  ...overrides: Partial<AgentConfig>[]
): AgentConfig
```

### `AppConfig` — `packages/app/src/config/types.ts`

```typescript
export interface AppConfig {
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio' | 'inspector'
  configDir: string
  dataDir: string
  http: { port: number; token: string }
  inspector: { port: number }
  skillDirs: string[]
  storage: { format: 'jsonl'; maxSessions: number; ttlDays: number }
  logsEnabled: boolean
  logLevel: LogLevel
  tracesEnabled: boolean
  mcp?: { server?: McpServerConfig }
  providers: { /* credentials only */ }
}

/** Fully resolved config. */
export interface RaConfig {
  app: AppConfig
  agent: AgentConfig
}
```

### Merge Strategy

| Field | Strategy |
|-------|----------|
| Scalars | Last-write-wins |
| `tools.overrides` | Deep merge per tool name |
| `middleware` | Per-hook array concat |
| `permissions.rules` | Array concat |
| `mcp.client` | Array concat, dedupe by `name` |
| Objects (`compaction`, `memory`) | Shallow merge |

## Extension: Cron

With independent files, cron is natural. A cron config references agent configs:

**`cron.yml`** (in any config root):
```yaml
jobs:
  - name: pr-review
    schedule: "0 9 * * 1-5"
    agent: ./recipes/code-review.yml    # standalone agent file
    prompt: "Review all open PRs"

  - name: quick-check
    schedule: "*/30 * * * *"
    agent: ./recipes/quick-check.yml
    prompt: "Check build status"
```

Each job references its own agent config file. No ambiguity — each file has one purpose. Same pattern works for `webhook.yml`, `watch.yml` later.

## Files to Modify

| File | Change |
|------|--------|
| `packages/ra/src/agent/config.ts` | **NEW** — `AgentConfig`, `mergeAgentConfig()`, `defaultAgentConfig` |
| `packages/ra/src/index.ts` | Export new types and functions |
| `packages/app/src/config/types.ts` | `AppConfig` + `RaConfig { app, agent }`, remove `skills` |
| `packages/app/src/config/defaults.ts` | Split defaults, import `defaultAgentConfig` from core |
| `packages/app/src/config/index.ts` | Load from global + local + explicit config roots; merge layers; update env/CLI paths |
| `packages/app/src/bootstrap.ts` | `config.agent.*` and `config.app.*` instead of flat `config.*` |
| `packages/app/src/interfaces/cli.ts` | Update config access |
| `packages/app/src/interfaces/repl.ts` | Update config access |
| `packages/app/src/interfaces/http.ts` | Update config access |
| `packages/app/src/interfaces/parse-args.ts` | Route flags to `agent.*` or `app.*`; add `--config` dir flag |
| `packages/app/src/skills/loader.ts` | Remove `skills` config usage |
| `packages/app/src/tools/index.ts` | Read from `config.agent.tools` |
| `recipes/coding-agent/ra.config.yaml` | Replace with `agent.yml` (agent fields only) + `app.yml` if needed |
| `recipes/code-review-agent/ra.config.yaml` | Same |

## Verification

1. `bun tsc` — zero errors
2. `bun test` — all tests pass
3. Global config in `~/.config/ra/agent.yml` applies to `bun run ra` from any directory
4. Local `.ra/config/agent.yml` overrides global
5. `--config ./recipes/coding-agent/` overrides local
6. Missing files at any layer → defaults for that part
7. `import { AgentConfig, mergeAgentConfig } from '@chinmaymk/ra'` works
8. `mergeAgentConfig(base, { model: 'sonnet' })` correctly overrides

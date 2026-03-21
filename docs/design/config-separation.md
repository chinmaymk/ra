# Config Separation: Named Sections in One File

## Context

`RaConfig` is a flat interface mixing app deployment, agent behavior, and credentials. No composable agent config type exists in the core library. Recipes mix concerns. We want clean separation with composability.

## What We're Doing

1. **`AgentConfig` type** in `packages/ra` — portable, composable agent behavior config.
2. **`AppConfig` type** in `packages/app` — deployment/environment config.
3. **One config file**, named sections — `app:`, `agent:`, `cron:` (future). No loose top-level fields.
4. **`mergeAgentConfig()`** — compose base + overrides for layered configs.
5. **`agent:` can be a path** — reference a standalone recipe file.
6. Remove `skills` from config (loaded from prompt).

## Config File Format

One file (`ra.config.yaml`), everything under named keys:

```yaml
app:
  interface: repl
  dataDir: .ra
  skillDirs: [./skills]
  logsEnabled: true
  logLevel: info
  http:
    port: 3001

agent:
  provider: anthropic
  model: claude-opus-4-6
  thinking: high
  maxIterations: 200
  tools:
    builtin: true
  compaction:
    enabled: true
    threshold: 0.8
```

### Referencing a recipe

`agent:` can be a path to a standalone agent config file:

```yaml
app:
  interface: repl

agent: ./recipes/coding-agent.yml
```

The referenced file contains just `AgentConfig` fields (no `agent:` wrapper — it IS the agent config):

```yaml
# recipes/coding-agent.yml
provider: anthropic
model: claude-opus-4-6
thinking: high
maxIterations: 200
tools:
  builtin: true
```

### Cron — composable via base `agent:`

Top-level `agent:` is the base config. Each cron job inherits from it and can override:

```yaml
app:
  interface: cron

agent:
  provider: anthropic
  model: claude-opus-4-6
  tools: { builtin: true }
  compaction: { enabled: true, threshold: 0.8 }

cron:
  - name: pr-review
    schedule: "0 9 * * 1-5"
    agent: ./recipes/code-review.yml   # standalone recipe, replaces base
    prompt: "Review all open PRs"

  - name: quick-check
    schedule: "*/30 * * * *"
    agent:                              # partial override, merged with base
      model: claude-haiku-4-5
      maxIterations: 5
    prompt: "Check build status"
```

Effective config for quick-check: `mergeAgentConfig(base, { model: 'haiku', maxIterations: 5 })`.

Same pattern extends to future sections (`webhook:`, `watch:`, etc.).

## Config Discovery

### Global: `~/.ra/config.yaml`

User-level defaults. Good for default provider, credentials, personal preferences.

### Local: `.ra/config.yaml` (discovered by upward search)

Project-level config. Discovered by searching upward from cwd for a `.ra/` directory.

```
project/
  .ra/
    config.yaml   # project config
    sessions/     # data (unchanged)
    memory/       # data (unchanged)
```

### Explicit: `--config <path>`

Overrides local. Points to a config file or directory.

```bash
bun run ra --config ./recipes/coding-agent/
```

### Merge order

```
global (~/.ra/config.yaml)
  → local (.ra/config.yaml, discovered upward)
    → explicit (--config)
      → env vars (RA_*)
        → CLI flags (--model, --provider, etc.)
```

Each layer merges per-section: `app:` fields merge with `app:`, `agent:` fields merge with `agent:`.

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

### Merge Strategy for `mergeAgentConfig()`

| Field | Strategy |
|-------|----------|
| Scalars | Last-write-wins |
| `tools.overrides` | Deep merge per tool name |
| `middleware` | Per-hook array concat |
| `permissions.rules` | Array concat |
| `mcp.client` | Array concat, dedupe by `name` |
| Objects (`compaction`, `memory`) | Shallow merge |

## Files to Modify

| File | Change |
|------|--------|
| `packages/ra/src/agent/config.ts` | **NEW** — `AgentConfig`, `mergeAgentConfig()`, `defaultAgentConfig` |
| `packages/ra/src/index.ts` | Export new types and functions |
| `packages/app/src/config/types.ts` | `AppConfig` + `RaConfig { app, agent }`, remove `skills` |
| `packages/app/src/config/defaults.ts` | Split defaults, import `defaultAgentConfig` from core |
| `packages/app/src/config/index.ts` | Load `config.yaml` from global/local/explicit; parse `app:` + `agent:` sections; handle `agent:` as path |
| `packages/app/src/bootstrap.ts` | `config.agent.*` and `config.app.*` instead of flat `config.*` |
| `packages/app/src/interfaces/cli.ts` | Update config access |
| `packages/app/src/interfaces/repl.ts` | Update config access |
| `packages/app/src/interfaces/http.ts` | Update config access |
| `packages/app/src/interfaces/parse-args.ts` | Route flags to `agent.*` or `app.*`; add `--config` flag |
| `packages/app/src/skills/loader.ts` | Remove `skills` config usage |
| `packages/app/src/tools/index.ts` | Read from `config.agent.tools` |
| `recipes/coding-agent/` | Restructure: `config.yaml` with `app:` + `agent:` sections |
| `recipes/code-review-agent/` | Same |

## Verification

1. `bun tsc` — zero errors
2. `bun test` — all tests pass
3. Global `~/.ra/config.yaml` applies as base
4. Local `.ra/config.yaml` overrides global per-section
5. `--config` overrides local
6. `agent: ./path/to/recipe.yml` loads external agent config
7. Cron jobs inherit from base `agent:` and can override
8. `import { AgentConfig, mergeAgentConfig } from '@chinmaymk/ra'` works
9. `mergeAgentConfig(base, { model: 'sonnet' })` correctly overrides

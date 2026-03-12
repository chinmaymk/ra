# Multi-Agent Single-Process Orchestrator — Implementation Plan

## Overview

Today, `ra` boots one config → one bootstrap → one interface. The orchestrator adds a new mode: one process loads multiple agent configs, each with its own provider/tools/middleware/memory, and exposes them through a single interface with `/agent-name` routing.

## Design Decisions (from discussion)

### Config Ownership

| Category | Keys | Rule |
|----------|------|------|
| **Override** (orchestrator wins) | `interface`, `sessionsDir` | Agent config may have these; ignored in orchestrator mode |
| **Merge** (orchestrator appends to agent) | `skillDirs`, `context.patterns` | `[...agent, ...orchestrator]` |
| **Agent-only** (orchestrator never sets) | Everything else (`provider`, `model`, `tools`, `middleware`, `systemPrompt`, `memory`, `mcp`, `permissions`, `compaction`, `maxIterations`, `toolTimeout`, `thinking`) | Orchestrator errors if these keys appear |
| **Orchestrator-only** | `agents` | Required. Maps agent names to config paths + options |

### Required orchestrator keys (error if missing)
- `agents` — the whole point
- `interface` — must know how to expose the process

### Optional orchestrator keys (with defaults)
- `sessionsDir` — defaults to `./sessions`
- `skillDirs` — defaults to `[]`
- `context.patterns` — defaults to `[]`

### Unknown keys → hard error
```
Error: Unknown key "model" in ra.agents.yml.
Orchestrator config only accepts: agents, interface, sessionsDir, skillDirs, context.patterns.
Set "model" in individual agent configs instead.
```

### Agent invocation via `/agent-name`
```
/coder fix the bug        →  agent: "coder", prompt: "fix the bug"
/reviewer check auth.ts   →  agent: "reviewer", prompt: "check auth.ts"
just fix it               →  agent: default, prompt: "just fix it"
/unknown do stuff          →  error: unknown agent "unknown"
```

### Agent name / skill name collision → startup error
```
Error: "reviewer" is both an agent name and a skill name. Rename one.
```

### Memory

Each agent's memory config is **agent-only** — the orchestrator never sets it. But there's a path resolution concern: if two agents both use the default `memory.path: .ra/memory.db` and have the same `configDir`, they'd share the same SQLite file unintentionally. The orchestrator handles this:

**Rule**: During `mergeAgentConfig()`, if the agent has `memory.enabled: true`, override `memory.path` to `{sessionsDir}/{agentName}/memory.db`. This gives each agent its own isolated memory DB, co-located with its sessions.

```
{sessionsDir}/
  coder/
    memory.db              ← coder's memories
    {sessionId}/
      meta.json
      messages.jsonl
  reviewer/
    memory.db              ← reviewer's memories
    {sessionId}/
      ...
```

**Why not respect the agent's `memory.path`?** Because:
1. Two agents with the same `configDir` would collide on the default path
2. SQLite doesn't handle concurrent writers from the same process well without WAL+busy_timeout, and even then FTS5 triggers can conflict
3. Co-locating memory with sessions keeps the orchestrator's data self-contained in `sessionsDir`

**If the agent explicitly sets a non-default `memory.path`** (not `.ra/memory.db`): still override. The orchestrator owns data placement. If someone needs a shared memory DB across agents, that's a future feature (and would require a shared `MemoryStore` instance, not two instances pointing at the same file).

### Sessions
`{sessionsDir}/{agent-name}/{sessionId}/` — each agent namespaced. Logs go to session dir (existing behavior, no new logsDir concept).

### Orchestrator config shape
```yaml
# ra.agents.yml
interface: http          # required
sessionsDir: ./sessions  # optional
skillDirs: []            # optional, merged into each agent
context:
  patterns: []           # optional, merged into each agent

agents:                  # required
  coder:
    config: ./agents/coding/ra.config.yml
    default: true
  reviewer:
    config: ./agents/review/ra.config.yml
```

---

## Implementation Steps

### Step 1: Orchestrator Config Types

**File: `src/orchestrator/types.ts`** (new)

```ts
export interface OrchestratorAgentEntry {
  config: string        // path to ra.config.yml (relative to orchestrator config dir)
  default?: boolean     // at most one agent
}

export interface OrchestratorConfig {
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio'
  sessionsDir: string   // default: './sessions'
  skillDirs: string[]   // merged into each agent's skillDirs
  context: {
    patterns: string[]  // merged into each agent's context.patterns
  }
  agents: Record<string, OrchestratorAgentEntry>
  // Resolved at load time:
  configDir: string     // directory containing the orchestrator config file
  http?: { port: number; token?: string }  // needed when interface is 'http'
}
```

### Step 2: Orchestrator Config Loader

**File: `src/orchestrator/config.ts`** (new)

- `loadOrchestratorConfig(path: string): OrchestratorConfig`
- Parse YAML/JSON/TOML file at the given path
- Validate required keys: `agents`, `interface`
- Validate no unknown keys (allowlist: `agents`, `interface`, `sessionsDir`, `skillDirs`, `context`, `http`)
- Validate at most one agent has `default: true`
- Validate all agent config paths exist and are readable
- Set defaults: `sessionsDir` → `'./sessions'`, `skillDirs` → `[]`, `context.patterns` → `[]`
- Resolve `configDir` to the directory containing the orchestrator config file

### Step 3: Agent Config Merging

**File: `src/orchestrator/merge.ts`** (new)

- `mergeAgentConfig(agentConfig: RaConfig, orchestratorConfig: OrchestratorConfig, agentName: string): RaConfig`
- Override: `interface` → set to orchestrator's value (agent's ignored)
- Override: `storage.path` → `{sessionsDir}/{agentName}` (resolved against orchestrator configDir)
- Override: `memory.path` → `{sessionsDir}/{agentName}/memory.db` (if `memory.enabled` is true)
- Merge: `skillDirs` → `[...agent.skillDirs, ...orchestrator.skillDirs]`
- Merge: `context.patterns` → `[...agent.context.patterns, ...orchestrator.context.patterns]`
- Everything else: untouched from agent config

The full merge table:

| Agent config key | Merge behavior | Orchestrator source |
|-----------------|----------------|---------------------|
| `interface` | **Override** (agent's value ignored) | `orchestratorConfig.interface` |
| `storage.path` | **Override** (agent's value ignored) | `{sessionsDir}/{agentName}` |
| `memory.path` | **Override** (agent's value ignored, only if memory.enabled) | `{sessionsDir}/{agentName}/memory.db` |
| `skillDirs` | **Append** | `[...agent, ...orchestrator.skillDirs]` |
| `context.patterns` | **Append** | `[...agent, ...orchestrator.context.patterns]` |
| `provider` | **Untouched** | — |
| `model` | **Untouched** | — |
| `systemPrompt` | **Untouched** | — |
| `middleware` | **Untouched** | — |
| `mcp` | **Untouched** | — |
| `memory.enabled` | **Untouched** | — |
| `memory.maxMemories` | **Untouched** | — |
| `memory.ttlDays` | **Untouched** | — |
| `memory.injectLimit` | **Untouched** | — |
| `permissions` | **Untouched** | — |
| `compaction` | **Untouched** | — |
| `maxIterations` | **Untouched** | — |
| `toolTimeout` | **Untouched** | — |
| `thinking` | **Untouched** | — |
| `builtinTools` | **Untouched** | — |
| `builtinSkills` | **Untouched** | — |
| `maxConcurrency` | **Untouched** | — |
| `observability` | **Untouched** | — |
| `providers.*` | **Untouched** | — |
| `http` | **Untouched** (not used per-agent) | — |

### Step 4: Multi-Agent Bootstrap

**File: `src/orchestrator/bootstrap.ts`** (new)

- `bootstrapOrchestrator(config: OrchestratorConfig): Promise<OrchestratorContext>`
- For each agent in `config.agents`:
  1. Load agent's `ra.config.yml` via existing `loadConfig({ configPath: entry.config })`
  2. Merge with orchestrator config via `mergeAgentConfig()`
  3. Run existing `bootstrap(mergedConfig, {})` → get `AppContext`
  4. Collect skill names for collision detection
- After all agents bootstrapped:
  - Check for agent name / skill name collisions across all agents
  - Error if collision found

```ts
export interface OrchestratorContext {
  config: OrchestratorConfig
  agents: Map<string, AppContext>  // name → fully bootstrapped agent
  defaultAgent: string | undefined
  shutdown: () => Promise<void>
}
```

### Step 5: Message Router

**File: `src/orchestrator/router.ts`** (new)

- `parseRoute(input: string, agentNames: string[]): { agentName: string; message: string } | { error: string }`
- Check if input starts with `/{name} ` where `name` is a known agent
- If yes: strip prefix, return agent name + remaining message
- If no prefix: return default agent name + full message
- If no prefix and no default: return error
- If prefix matches no agent: return error listing available agents

### Step 6: Startup Validation

**File: `src/orchestrator/validate.ts`** (new)

- `validateOrchestratorConfig(config: OrchestratorConfig): void` — throws on invalid config
  - Required keys present
  - No unknown keys (with helpful error message pointing to agent config)
  - At most one default agent
  - Agent config paths resolve
- `validateNoNameCollisions(agents: Map<string, AppContext>): void`
  - Collect all skill names from all agents' skillMaps
  - Check no agent name appears as a skill name in any agent
  - Error with specific collision details

### Step 7: CLI Flag `--agents`

**File: `src/interfaces/parse-args.ts`** (modify)

- Add `--agents <path>` flag to `parseArgs()`
- When `--agents` is present, the orchestrator config path is captured in `parsed.meta.agentsConfig`
- This flag is mutually exclusive with `--config` (error if both provided)

### Step 8: Entry Point Integration

**File: `src/index.ts`** (modify)

Add orchestrator branch before the existing single-agent flow:

```ts
if (parsed.meta.agentsConfig) {
  const orchConfig = await loadOrchestratorConfig(parsed.meta.agentsConfig)
  const orchCtx = await bootstrapOrchestrator(orchConfig)
  const signals = onSignals(orchCtx.shutdown)
  // Launch interface with orchestrator context instead of single AppContext
  return launchOrchestratorInterface(orchConfig, orchCtx, signals)
}
```

### Step 9: Orchestrator Interface Launchers

**File: `src/orchestrator/interfaces.ts`** (new)

Wire the orchestrator context into existing interfaces. Each interface needs to know how to route `/agent-name` messages.

**HTTP**: Create one `HttpServer` but override its chat handlers to:
1. Parse the route from the message
2. Dispatch to the correct agent's loop
3. Use the correct agent's provider/tools/middleware

**REPL**: Wrap the existing `Repl` with routing logic:
1. On user input, parse the route
2. Run the agent loop for the matched agent
3. Display which agent is responding

**CLI**: Parse the route from `--prompt`, dispatch to the correct agent.

The key change: instead of one `AgentLoop` per request, the orchestrator selects which `AppContext` to use, then creates an `AgentLoop` from that context's provider/tools/middleware.

### Step 10: Orchestrator Config Auto-Discovery

**File: `src/orchestrator/config.ts`** (extend)

- Look for `ra.agents.yml`, `ra.agents.yaml`, `ra.agents.json`, `ra.agents.toml` in the same way `loadConfig` discovers `ra.config.*`
- Walk from cwd upward to git root
- If found and `--agents` not explicitly provided, use it automatically
- If both `ra.config.*` and `ra.agents.*` exist, `ra.agents.*` takes precedence (it's a superset)

### Step 11: Tests

**Directory: `tests/orchestrator/`** (new)

| Test file | What it covers |
|-----------|----------------|
| `config.test.ts` | Loader: required keys, unknown keys error, defaults |
| `merge.test.ts` | Override/merge/agent-only behavior |
| `router.test.ts` | `/name` parsing, default routing, error cases |
| `validate.test.ts` | Name collisions, duplicate defaults, missing paths |
| `bootstrap.test.ts` | Multi-agent bootstrap with mock configs |
| `integration.test.ts` | End-to-end: load orchestrator config → bootstrap → route message → get response |

---

## File Summary

### New files (8)
```
src/orchestrator/types.ts       # OrchestratorConfig, OrchestratorAgentEntry
src/orchestrator/config.ts      # loadOrchestratorConfig(), auto-discovery
src/orchestrator/merge.ts       # mergeAgentConfig()
src/orchestrator/bootstrap.ts   # bootstrapOrchestrator() → OrchestratorContext
src/orchestrator/router.ts      # parseRoute()
src/orchestrator/validate.ts    # validateOrchestratorConfig(), validateNoNameCollisions()
src/orchestrator/interfaces.ts  # Orchestrator-aware interface launchers
src/orchestrator/index.ts       # Public exports
```

### Modified files (2)
```
src/interfaces/parse-args.ts    # Add --agents flag
src/index.ts                    # Add orchestrator branch in main()
```

### New test files (6)
```
tests/orchestrator/config.test.ts
tests/orchestrator/merge.test.ts
tests/orchestrator/router.test.ts
tests/orchestrator/validate.test.ts
tests/orchestrator/bootstrap.test.ts
tests/orchestrator/integration.test.ts
```

---

## How Agent Config Paths Resolve

This is critical for correctness. Many agent config values are relative paths that resolve against `configDir`. Here's how it works:

### Current behavior (single-agent)
`loadConfig()` discovers `ra.config.yml`, sets `configDir` to its parent directory. Then `bootstrap()` resolves:
- `storage.path` → `resolvePath('.ra/sessions', configDir)`
- `memory.path` → `resolvePath('.ra/memory.db', configDir)`
- `skillDirs[i]` → `resolvePath(dir, configDir)`
- `middleware` file paths → resolved against `configDir`
- `mcp.client[].command` → resolved against `configDir`

### Orchestrator behavior
Each agent's `ra.config.yml` is loaded via `loadConfig({ configPath: entry.config })`. This sets `configDir` to the **agent config file's directory** — not the orchestrator's directory. This means:
- Agent-relative paths (middleware, MCP, skills within the agent dir) resolve correctly
- The orchestrator then overrides `storage.path` and `memory.path` with orchestrator-relative paths

**Example directory layout:**
```
project/
  ra.agents.yml                          ← orchestrator config (configDir: project/)
  sessions/                              ← orchestrator's sessionsDir
    coder/
      memory.db                          ← coder's memory (overridden by orchestrator)
      abc123/                            ← coder's session
    reviewer/
      memory.db                          ← reviewer's memory (overridden by orchestrator)
      def456/                            ← reviewer's session
  agents/
    coding/
      ra.config.yml                      ← coder agent config (configDir: agents/coding/)
      middleware/audit.ts                ← resolves against agents/coding/
      skills/                            ← agent's own skills dir
    review/
      ra.config.yml                      ← reviewer agent config (configDir: agents/review/)
      .ra/memory.db                      ← IGNORED — overridden to sessions/reviewer/memory.db
```

**The key insight**: `configDir` is set by `loadConfig()` when it parses the agent's config file. We don't touch it. The orchestrator only overrides the specific path fields (`storage.path`, `memory.path`) that it needs to control for isolation. Everything else (middleware paths, MCP paths, skill dirs) resolves naturally against the agent's own `configDir`.

### Orchestrator `skillDirs` and `context.patterns`
These are resolved against the **orchestrator's `configDir`** before being appended to the agent's arrays. This way an orchestrator can point to shared skill directories that all agents can see:

```yaml
# ra.agents.yml
skillDirs:
  - ./shared-skills    # resolved against project/ (orchestrator configDir)
```

The merge produces: `[...agent.skillDirs, resolvePath('./shared-skills', orchConfigDir)]`

---

## What This Does NOT Change

- Existing single-agent flow is untouched. No `--agents` flag → everything works exactly as before.
- `AgentPool` stays as-is for the HTTP `/agents/*` API (it's a different use case: runtime-created agents sharing config).
- No new `logsDir` concept. Logs go to session dirs as today.
- No config inheritance/defaults from orchestrator to agents. Agent configs are self-contained.
- `bootstrap()` function is not modified. Each agent gets a full `bootstrap()` call with its own merged config.

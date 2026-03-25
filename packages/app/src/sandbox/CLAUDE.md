# src/sandbox/

Docker-isolated ra agent instances. Each `Sandbox` runs an `AgentLoop` inside a Docker container with separate filesystem, network, and resource limits.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | `SandboxConfig`, wire protocol types (`SandboxCommand`, `SandboxEvent`) |
| `sandbox.ts` | `Sandbox` class — main-thread API for creating/running/destroying sandboxes |
| `sandbox-entry.ts` | Container entry point — reads NDJSON from stdin, reconstructs agent, runs loop |
| `config.ts` | `buildSandboxConfig()` — extracts serializable config from `RaConfig` |
| `Dockerfile` | Docker image definition for the sandbox container |

## Wire Protocol

NDJSON over stdio. Main thread writes `SandboxCommand` to stdin, reads `SandboxEvent` from stdout.

Commands: `init`, `run`, `abort`
Events: `ready`, `chunk`, `result`, `error`, `log`

## Key Constraint

Tools, providers, and middleware contain functions — can't cross the structured clone boundary. The container reconstructs everything from the serializable `SandboxConfig` using the same factories (`createProvider`, `registerBuiltinTools`, `loadMiddleware`).

## Usage

```typescript
import { Sandbox, buildSandboxConfig } from '../sandbox'

const sandbox = await Sandbox.create(config, { memory: '512m', network: 'none' })
const result = await sandbox.run(messages, (chunk) => { /* stream */ })
sandbox.destroy()
```

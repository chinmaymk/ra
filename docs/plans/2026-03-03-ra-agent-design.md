# ra — Generic Raw Agent Design

## Overview

`ra` is a general-purpose agentic framework built with Bun/TypeScript. It provides a configurable agent that can talk to multiple model providers, execute tools, load skills, connect to MCP servers, expose itself as an MCP server, and handle multimodal input. The goal is a raw agent that can be molded to do any task.

## Architecture

```
ra/
├── src/
│   ├── providers/          # IProvider + per-SDK implementations
│   │   ├── interface.ts    # IProvider, IMessage, IToolCall, IStream types
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   ├── google.ts
│   │   └── ollama.ts
│   ├── agent/
│   │   ├── loop.ts         # Agentic loop: stream → tools → loop
│   │   ├── context.ts      # Conversation state, message history
│   │   └── middleware.ts   # Middleware chain runner
│   ├── skills/
│   │   ├── loader.ts       # Scan dirs, load .md + .ts/.sh sidecars
│   │   └── runner.ts       # Execute sidecar scripts, inject content
│   ├── mcp/
│   │   ├── client.ts       # Connect to MCP servers, discover tools
│   │   └── server.ts       # Expose agent as MCP server
│   ├── config/
│   │   └── index.ts        # Merge: defaults < config file < env vars < CLI args
│   ├── interfaces/
│   │   ├── cli.ts          # Single-shot CLI mode
│   │   ├── repl.ts         # Interactive REPL
│   │   └── http.ts         # HTTP API server (REST + SSE)
│   ├── storage/
│   │   └── sessions.ts     # Session persistence, checkpoint, resume
│   └── index.ts            # Entry point
├── ra.config.json          # Default config file
└── package.json
```

## Provider Interface

All providers implement a unified interface. Each provider maps these types to its native SDK.

```typescript
interface IProvider {
  chat(request: ChatRequest): Promise<ChatResponse>
  stream(request: ChatRequest): AsyncIterable<StreamChunk>
}

interface ChatRequest {
  model: string
  messages: IMessage[]
  tools?: ITool[]
  providerOptions?: Record<string, unknown>  // pass-through for provider-specific params
}

interface IMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | ContentPart[]
}

interface ITool {
  name: string
  description: string
  inputSchema: JSONSchema
  execute(input: unknown): Promise<unknown>
}

type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'done'; usage?: TokenUsage }
```

System messages in the `messages` array are handled internally by each provider adapter — Anthropic extracts them into its `system` field, OpenAI keeps them as `role: system`, etc.

The `providerOptions` field is an escape hatch for provider-specific parameters (extended thinking, search grounding, temperature, etc.) without polluting the common interface.

### Supported Providers

- **Anthropic** — `@anthropic-ai/sdk`
- **OpenAI** — `openai`
- **Google** — `@google/generative-ai`
- **Ollama** — `ollama`

## Config System

Config merges in priority order: **defaults < config file < env vars < CLI args**.

### Config File

Searched in order:
1. Path from `--config` CLI arg
2. `./ra.config.{json,yml,toml}` in cwd
3. `~/.config/ra/config.{json,yml,toml}`

Supported formats: JSON, YAML, TOML.

### Example Config

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "interface": "repl",
  "systemPrompt": "./prompts/assistant.md",
  "http": { "port": 3000, "token": "" },
  "skills": ["~/.ra/skills", "./skills"],
  "alwaysLoad": [],
  "mcp": {
    "client": [
      { "name": "filesystem", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
    ],
    "server": {
      "enabled": false,
      "port": 3001,
      "tool": {
        "name": "agent",
        "description": "A general purpose agent",
        "inputSchema": {}
      }
    }
  },
  "providers": {
    "anthropic": { "apiKey": "" },
    "openai": { "apiKey": "" },
    "google": { "apiKey": "" },
    "ollama": { "baseUrl": "http://localhost:11434" }
  },
  "storage": {
    "path": "~/.ra/sessions",
    "format": "jsonl",
    "maxSessions": 100,
    "ttlDays": 30
  },
  "maxIterations": 50,
  "middleware": {}
}
```

### Env Vars

- `RA_PROVIDER`, `RA_MODEL`, `RA_INTERFACE`, `RA_SYSTEM_PROMPT`
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- `RA_STORAGE_PATH`, `RA_HTTP_TOKEN`

### CLI Args

Override everything: `ra --provider openai --model gpt-4o "do something"`

### System Prompt

`systemPrompt` accepts either an inline string or a file path. If it resolves to a file, its contents are read and used. Configurable via config file, `RA_SYSTEM_PROMPT` env var, or `--system-prompt` CLI arg.

## Skills System

Skills follow the [Agent Skills specification](https://agentskills.io). Each skill is a directory containing a required `SKILL.md` file with optional supporting directories:

```
skills/
├── summarize/
│   ├── SKILL.md            # Required — frontmatter + instructions
│   ├── scripts/            # Optional — executable code (ts, sh, py)
│   │   └── run.ts
│   ├── references/         # Optional — additional docs loaded on demand
│   │   └── REFERENCE.md
│   └── assets/             # Optional — templates, schemas, static files
│       └── template.json
├── web-search/
│   └── SKILL.md
```

### SKILL.md Format

```yaml
---
name: summarize
description: Summarizes documents and extracts key points. Use when the user asks for summaries or condensed versions of text.
license: MIT
metadata:
  author: ra
  version: "1.0"
allowed-tools: Read Bash(cat:*)
---

## Instructions

Step-by-step instructions for the agent...
```

**Required fields:**
- `name` — lowercase, hyphens only, 1-64 chars, must match directory name
- `description` — 1-1024 chars, describes what the skill does and when to use it

**Optional fields:**
- `license`, `compatibility`, `metadata`, `allowed-tools`

### Progressive Disclosure

1. **Metadata** (~100 tokens): `name` and `description` loaded at startup for all skills
2. **Instructions** (< 5000 tokens recommended): Full `SKILL.md` body loaded when skill is activated
3. **Resources** (as needed): Files in `scripts/`, `references/`, `assets/` loaded only when required

### Loading

- Skill directories are scanned at startup — only metadata is loaded initially
- Skills are addressable by name (directory name)
- Multiple skill dirs merged; later dirs override earlier ones
- `alwaysLoad` skills (from config) have their full `SKILL.md` body loaded into every session

### Activation

- **Explicit:** `ra --skill summarize "summarize this doc"`
- **Always-on:** listed in config `alwaysLoad`

### Execution Flow

1. Load `SKILL.md` body as a `role: 'user'` message
2. If scripts exist and are referenced, execute them — capture stdout as additional `role: 'user'` message
3. Scripts receive context via env vars: `RA_PROMPT`, `RA_MODEL`, `RA_PROVIDER`, and can read stdin
4. Agent proceeds with enriched context

Skills are always user messages. System prompt is a separate concern.

### Skills as Features

Planning and sub-agent spawning are implemented as skills, not core loop features. This keeps the loop lean.

## Agentic Loop

```
user input
    │
    ▼
build messages (history + skills + new input)
    │
    ▼
middleware: beforeLoopBegin
    │
    ▼
┌──────────── LOOP ────────────────────────────────────────────┐
│                                                              │
│  middleware: beforeModelCall                                  │
│      │                                                       │
│  provider.stream()                                           │
│      │                                                       │
│      ├─ chunks → middleware: onStreamChunk → stream to output │
│      │                                                       │
│      └─ complete                                             │
│                                                              │
│  middleware: afterModelResponse                               │
│      │                                                       │
│  if tool_calls:                                              │
│      for each call (concurrently via Promise.allSettled):    │
│          middleware: beforeToolExecution                      │
│          execute tool (with per-tool timeout)                │
│          middleware: afterToolExecution                       │
│      append all tool_results to messages                     │
│                                                              │
│  middleware: afterLoopIteration (checkpoint goes here)        │
│  check maxIterations → loop or break                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
middleware: afterLoopComplete
    │
    ▼
done → return to interface
```

On error at any point: `middleware: onError`

### Tool Resolution

Tools are resolved from a unified `ToolRegistry`:
1. Built-in tools (registered in config)
2. MCP client tools (from connected servers)
3. Skill-as-tool (skills with `asTool: true` in frontmatter)

All resolve to the same `ITool` interface. The agent doesn't know the source.

## Middleware

The entire loop lifecycle is driven by configurable middleware chains.

```typescript
type Middleware<T> = (ctx: T, next: () => Promise<void>) => Promise<void>
```

### Lifecycle Hooks

```typescript
{
  middleware: {
    beforeLoopBegin: [],       // before the agentic loop starts (setup, validation)
    beforeModelCall: [],       // before sending messages to provider
    onStreamChunk: [],         // each chunk as it arrives from provider
    beforeToolExecution: [],   // after model requests tool call, before running it
    afterToolExecution: [],    // after tool returns result, before appending to messages
    afterModelResponse: [],    // after full model response is assembled
    afterLoopIteration: [],    // after each loop iteration (checkpointing, counting)
    afterLoopComplete: [],     // after the full loop finishes, before returning to user
    onError: [],               // when any error occurs during the loop
  }
}
```

Any middleware can short-circuit by not calling `next()`. Middleware is registered via config (pointing to `.ts` files) or programmatically when using `ra` as a library.

Permissions, logging, rate limiting, checkpointing, and telemetry are all implemented as middleware.

## MCP

### Client Mode

Agent connects to configured MCP servers at startup, discovers tools, and registers them in the `ToolRegistry`.

```json
{
  "mcp": {
    "client": [
      { "name": "filesystem", "transport": "stdio", "command": "npx", "args": ["..."] },
      { "name": "db", "transport": "sse", "url": "http://localhost:4000/mcp" }
    ]
  }
}
```

Supported transports: **stdio** and **SSE**.

### Server Mode

Exposes the agent as an MCP server with a fully configurable tool identity:

```json
{
  "mcp": {
    "server": {
      "enabled": true,
      "port": 3001,
      "tool": {
        "name": "code_reviewer",
        "description": "Reviews code for bugs and style issues",
        "inputSchema": {
          "type": "object",
          "properties": {
            "code": { "type": "string", "description": "Code to review" },
            "language": { "type": "string", "description": "Programming language" }
          },
          "required": ["code"]
        }
      }
    }
  }
}
```

The consuming LLM sees a clean, descriptive tool definition. The `ra` instance maps the tool input into a user message, runs the agent loop, and returns the final response as the tool result.

## Multimodality

```typescript
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'file'; mimeType: string; data: Buffer | string }

type ImageSource =
  | { type: 'base64'; mediaType: string; data: string }
  | { type: 'url'; url: string }
```

### Input

- **CLI:** `ra --file image.png "what's this?"`
- **REPL:** `/attach <file>` command
- **HTTP:** multipart form upload

### Per-Provider Mapping

Each provider adapter converts `ContentPart` to its native format. If a provider doesn't support a modality, it returns a clear error before calling the API.

### Tool Results

Tool results can also return `ContentPart[]`, so tools that produce images or files can pass them back to the model.

## Interfaces

All three interfaces share the same core: build messages, run agent loop, output result.

### CLI Mode

`ra "summarize this file" --file doc.pdf`

- Prompt as positional arg, files via `--file`
- Stdout: streamed text. Stderr: status/tool info
- Exit code 0 on success, 1 on error
- Pipeable

### REPL Mode

`ra` (default)

- Persistent session with message history
- Commands: `/attach <file>`, `/skill <name>`, `/clear`, `/save`, `/resume <id>`
- Session auto-checkpointed, resumable via `ra --resume <id>`

### HTTP Mode

`ra serve`

- `POST /chat` — send messages, streamed response (SSE)
- `POST /chat/sync` — non-streaming, full response
- `GET /sessions` — list/resume sessions
- Optional bearer token auth via config `http.token` or `RA_HTTP_TOKEN`
- Stateless per-request or stateful with session IDs

## Session Storage

Sessions are stored in a configurable location. Each session is a directory:

```
~/.ra/sessions/
└── abc123/
    ├── meta.json       # { id, created, provider, model, interface }
    ├── messages.jsonl   # append-only message log
    └── checkpoint.json  # latest loop state for resume
```

### Config

```json
{
  "storage": {
    "path": "~/.ra/sessions",
    "format": "jsonl",
    "maxSessions": 100,
    "ttlDays": 30
  }
}
```

Overridable via `RA_STORAGE_PATH` env var or `--storage-path` CLI arg.

Old sessions are pruned when `maxSessions` is exceeded or `ttlDays` expires.

## Data Flow Summary

```
Config loads → Providers init → Skills load → MCP clients connect
    → Interface starts (CLI/REPL/HTTP)
        → User input → Skill injection (user messages) → Agent loop
            → middleware chains at each lifecycle point
            → provider.stream() → tool_calls → ToolRegistry.execute()
            → checkpoint → loop or done
        → Output to interface
```

Everything resolves through the same types: `IMessage`, `ITool`, `ContentPart`, `StreamChunk`. All three interfaces produce and consume the same primitives. Providers, tools, skills, and middleware are all pluggable via config.

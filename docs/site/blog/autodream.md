# Building Claude Code's AutoDream with ra

<span class="blog-date">April 2, 2026</span>

Claude Code recently shipped AutoDream — a background memory consolidation system that prevents "memory rot" across long-lived coding sessions. When idle, a sub-agent wakes up, reviews accumulated notes, merges duplicates, resolves contradictions, and prunes stale context. The result: a compact, accurate memory file that loads fast and stays relevant.

This post walks through building the same system with ra — using cron jobs, middleware, memory tools, and skills. No special runtime features required. Just config and a few TypeScript files.

## The problem AutoDream solves

As an agent works across sessions, it accumulates memories: build commands, architecture decisions, user preferences, debugging notes. After 20+ sessions this leads to:

- **Bloat** — large memory stores consume tokens, leaving less room for actual work
- **Contradictions** — old facts ("use Express") conflict with newer ones ("migrated to Fastify")
- **Stale context** — references to deleted files or outdated solutions linger
- **Temporal confusion** — relative dates like "yesterday" become meaningless weeks later

AutoDream's insight is simple: run a maintenance agent periodically to clean this up. Let's build it.

## Architecture overview

```
Cron trigger (every 24h)
  → "dream" agent session starts
    → Phase 1: Orientation (search memories, read MEMORY.md index)
    → Phase 2: Gather signal (scan recent session transcripts)
    → Phase 3: Consolidation (merge, deduplicate, resolve conflicts)
    → Phase 4: Prune & reindex (rebuild MEMORY.md, enforce size limit)
  → Agent session ends
```

ra gives us every building block:

| AutoDream concept | ra feature |
|-------------------|------------|
| Periodic trigger | [Cron jobs](/modes/cron) |
| Background sub-agent | Cron creates isolated sessions |
| Memory read/write | [Memory tools](/tools/#memory) (`memory_save`, `memory_search`, `memory_forget`) |
| Session transcript access | [Sessions](/core/sessions) stored as directories with JSONL message logs — readable with `Read` and `Grep` tools |
| Sandboxed execution | [Permissions](/permissions/) — restrict to memory files only |
| Concurrency protection | Lock file via [middleware](/middleware/) |

## Understanding session storage

Before building the dream skill, it helps to know what the agent will be reading. ra stores each session as a directory:

```
.ra/sessions/{uuid}/
  meta.json          # {"id", "created", "provider", "model", "interface"}
  messages.jsonl     # one JSON object per line — the conversation log
```

Each line in `messages.jsonl` is an `IMessage` object:

```jsonl
{"role":"user","content":"Fix the failing tests in src/auth.ts"}
{"role":"assistant","content":"Let me look at the test file...","toolCalls":[{"id":"call_1","name":"Read","arguments":"{\"path\":\"src/auth.test.ts\"}"}]}
{"role":"tool","toolCallId":"call_1","content":"1: import { authenticate } from './auth'\n2: ..."}
{"role":"assistant","content":"The issue is on line 14..."}
```

Messages have `role` (`user`, `assistant`, `tool`, `system`), `content` (string or content parts), and optional `toolCalls`/`toolCallId` fields. The `user` messages contain the human's actual words — that's where corrections, preferences, and "remember this" directives live. The `assistant` messages show what the agent learned. The `tool` messages contain raw output.

The dream agent will `Grep` across these files for high-signal patterns, then use `Read` to pull full context when it finds something worth consolidating.

## Step 1: The dream skill

Create a skill that contains the consolidation instructions. This is the system prompt that guides the dream agent through its four phases.

```
skills/
  dream/
    SKILL.md
```

```yaml
---
name: dream
description: Memory consolidation — merges, deduplicates, and prunes agent memories
disable-model-invocation: true
---

You are a memory maintenance agent. Your job is to consolidate, clean, and
compress the memory store so it stays fast and accurate.

## Session format

Sessions live in `.ra/sessions/{uuid}/`. Each directory has a `meta.json`
(with `created` timestamp, `model`, and `interface`) and a `messages.jsonl`
file. Each line in messages.jsonl is a JSON object with `role` (user,
assistant, tool, system) and `content`. User messages contain the human's
words; assistant messages contain the agent's responses and tool calls.

## Process

### Phase 1: Orientation
- Use `memory_search` with broad queries ("project", "preference", "convention",
  "tooling", "team") to survey what's currently stored
- Read the MEMORY.md index file if it exists
- Build a mental model of the current memory landscape: what topics are covered,
  what's recent vs. old, what might be stale

### Phase 2: Gather Signal
- Use `LS` on `.ra/sessions/` to list session directories
- Read `meta.json` in recent sessions to find the 5-10 most recent by `created` date
- Use `Grep` to search `messages.jsonl` files in those sessions for high-value patterns:
  - User corrections: "actually", "no, use", "instead of", "not X, Y"
  - Explicit saves: "remember", "note that", "keep in mind", "from now on"
  - Preference signals: "I prefer", "always use", "don't use", "let's switch to"
  - Project changes: new dependencies, renamed files, architecture decisions
- Use `Read` on specific message files to get full context around matches
- Focus on `"role":"user"` lines — these contain the human's actual intent

### Phase 3: Consolidation
For each cluster of related memories:
- Merge duplicates into a single, precise fact
- When facts contradict, keep the most recent one (check session `meta.json`
  `created` timestamps to determine recency)
- Convert relative dates to absolute (e.g., "yesterday" → "2026-04-01")
- Remove references to files or patterns that no longer exist in the codebase
  (use `LS` or `Glob` to verify file existence when unsure)
- Use `memory_forget` to remove outdated entries, then `memory_save` to store
  the consolidated version

### Phase 4: Prune & Index
- Use `memory_search` with broad queries to review the final state
- Delete any memories that are trivial, obvious, or no longer relevant
- Rebuild MEMORY.md as a concise index of all memories, grouped by tag
- Keep MEMORY.md under 200 lines
- Write a summary line at the top: date of consolidation, session count reviewed,
  memories added/removed/merged

## Rules
- Never modify source code, configs, or anything outside `.ra/` and MEMORY.md
- When in doubt, keep the memory — false deletions are worse than mild bloat
- Tag every saved memory: `preference`, `project`, `convention`, `team`, or `tooling`
- Write self-contained facts — each memory should make sense without context
- Include a date in time-sensitive memories (e.g., "As of 2026-04-01, using Fastify v5")
```

## Step 2: The lock file middleware

AutoDream needs concurrency protection — two instances shouldn't consolidate simultaneously. A simple lock file middleware handles this.

```typescript
// middleware/dream-lock.ts
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCK_FILE = join(process.cwd(), '.ra', 'dream.lock')
const STALE_MS = 30 * 60 * 1000 // 30 minutes

export default async (ctx: { stop: () => void }) => {
  if (existsSync(LOCK_FILE)) {
    const content = readFileSync(LOCK_FILE, 'utf-8')
    const lockTime = parseInt(content, 10)
    if (Date.now() - lockTime < STALE_MS) {
      ctx.stop()
      return
    }
  }

  writeFileSync(LOCK_FILE, String(Date.now()))

  // Clean up on exit — afterLoopComplete will call this
  process.on('exit', () => {
    try { unlinkSync(LOCK_FILE) } catch {}
  })
}
```

And a cleanup middleware for when the loop ends:

```typescript
// middleware/dream-unlock.ts
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'

const LOCK_FILE = join(process.cwd(), '.ra', 'dream.lock')

export default async () => {
  try { unlinkSync(LOCK_FILE) } catch {}
}
```

## Step 3: The cron config

Wire everything together in `ra.config.yml`:

```yaml
# ra.config.yml
app:
  dataDir: .ra

agent:
  provider: anthropic
  model: claude-sonnet-4-6
  thinking: medium
  memory:
    enabled: true
    maxMemories: 1000
    ttlDays: 90
    injectLimit: 5

  skillDirs:
    - ./skills

  tools:
    builtin: true
    # Sandbox: only allow reading sessions and modifying memory
    Write:
      rootDir: ".ra"
    Edit:
      rootDir: ".ra"
    DeleteFile:
      enabled: false

  permissions:
    rules:
      - tool: Bash
        command:
          deny: [".*"]  # no shell access during dreams

  middleware:
    beforeLoopBegin:
      - "./middleware/dream-threshold.ts"
      - "./middleware/dream-lock.ts"
    afterLoopComplete:
      - "./middleware/dream-unlock.ts"

cron:
  - name: dream
    schedule: "0 3 * * *"  # 3 AM daily
    prompt: "/dream Consolidate and clean up agent memories"
    agent:
      model: claude-sonnet-4-6
      thinking: medium
      maxIterations: 30
```

Key decisions:

- **Schedule**: `0 3 * * *` runs at 3 AM daily. Adjust to match your idle hours.
- **Sandboxing**: Shell access is denied. File writes are restricted to `.ra/`. The dream agent can only touch memory files and session data.
- **Middleware at app level**: Cron jobs inherit the top-level agent middleware. The `beforeLoopBegin` chain runs the threshold check first, then acquires the lock. `afterLoopComplete` releases it.
- **Thinking**: `medium` gives the agent enough reasoning depth to resolve contradictions without burning excessive tokens.

## Step 4: Smarter triggers with middleware

The config above already includes the threshold middleware in `beforeLoopBegin`. Claude Code's AutoDream doesn't just run on a fixed schedule — it triggers after enough sessions have accumulated. The `dream-threshold.ts` middleware checks for this before the lock is acquired.

```typescript
// middleware/dream-threshold.ts
import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SESSIONS_DIR = join(process.cwd(), '.ra', 'sessions')
const MIN_SESSIONS = 5
const MIN_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

export default async (ctx: { stop: () => void }) => {
  try {
    // Sessions are directories, each containing meta.json + messages.jsonl
    const dirs = readdirSync(SESSIONS_DIR).filter(d =>
      existsSync(join(SESSIONS_DIR, d, 'meta.json'))
    )
    const now = Date.now()
    const recentSessions = dirs.filter(d => {
      const stat = statSync(join(SESSIONS_DIR, d, 'meta.json'))
      return now - stat.mtimeMs < MIN_AGE_MS
    })

    if (recentSessions.length < MIN_SESSIONS) {
      ctx.stop() // not enough activity — skip this cycle
    }
  } catch {
    ctx.stop() // no sessions dir — nothing to consolidate
  }
}
```

It's already wired into the `beforeLoopBegin` chain in the config above, ordered before the lock. When the cron job fires, the threshold check runs first — if fewer than 5 sessions exist within the last 24 hours, the agent stops before acquiring the lock or making any LLM calls.

## Step 5: Manual override

Claude Code's `/dream` command lets you trigger consolidation on demand. With ra, this is just a CLI invocation using the skill:

```bash
ra "/dream Consolidate and clean up agent memories"
```

Or from the REPL:

```
› /dream
Skill "dream" will be injected with your next message.
› Consolidate memories — I just finished a major refactor
```

No cron needed. The same skill, same instructions, same sandboxing — just triggered manually.

## The full file tree

```
project/
  ra.config.yml
  skills/
    dream/
      SKILL.md
  middleware/
    dream-lock.ts
    dream-unlock.ts
    dream-threshold.ts
```

Four files. That's the entire AutoDream implementation.

## What makes this work

The key insight isn't the consolidation logic — it's that **the same agent loop that writes code can maintain its own memory**. ra doesn't need a special "dream mode" because the building blocks are already there:

- **Cron** gives you periodic execution with isolated sessions
- **Memory tools** give the agent read/write access to its own knowledge base
- **Skills** package the consolidation instructions as a reusable role
- **Middleware** handles locking, thresholds, and cleanup
- **Permissions** sandbox the agent so it can't touch source code

AutoDream is just an agent that maintains another agent's memories. With ra, that's a config file and a skill.

<style>
.blog-date {
  display: inline-block;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-bottom: 1rem;
}
</style>

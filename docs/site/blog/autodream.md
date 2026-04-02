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

## Process

### Phase 1: Orientation
- Use `memory_search` with broad queries to survey what's stored
- Read the MEMORY.md index file if it exists
- Build a mental model of the current memory landscape

### Phase 2: Gather Signal
- Use `Grep` to scan recent session files in `.ra/sessions/` for:
  - User corrections ("actually, use X instead of Y")
  - Explicit saves ("remember this")
  - Recurring themes across sessions
  - Build/test command changes
- Focus on the last 5-10 sessions

### Phase 3: Consolidation
For each cluster of related memories:
- Merge duplicates into a single, precise fact
- When facts contradict, keep the most recent one
- Convert relative dates to absolute (e.g., "yesterday" → "2026-04-01")
- Remove references to files or patterns that no longer exist in the codebase
- Use `memory_forget` to remove outdated entries
- Use `memory_save` to store consolidated versions

### Phase 4: Prune & Index
- Rebuild MEMORY.md as a concise index of all memories, grouped by tag
- Keep MEMORY.md under 200 lines
- Delete any memories that are trivial, obvious, or no longer relevant

## Rules
- Never modify source code, configs, or anything outside memory files
- When in doubt, keep the memory — false deletions are worse than mild bloat
- Tag every saved memory: preference, project, convention, team, or tooling
- Write self-contained facts — each memory should make sense without context
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

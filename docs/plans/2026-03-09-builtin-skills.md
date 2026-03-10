# Built-in Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Embed meta-skills (write-skill, write-recipe, write-middleware) in the ra binary so they're always discoverable without external skill directories.

**Architecture:** Built-in skills are SKILL.md files under `src/skills/builtin/` imported at build time. A new `loadBuiltinSkills()` function parses them and returns a `Map<string, Skill>`. Interfaces merge these into the available skills map, filtered by `config.builtinSkills`.

**Tech Stack:** Bun file imports, existing SKILL.md frontmatter parser, existing `buildAvailableSkillsXml()`.

---

### Task 1: Add `builtinSkills` to config

**Files:**
- Modify: `src/config/types.ts:11` (add field to `RaConfig`)
- Modify: `src/config/defaults.ts:1-48` (add default)

**Step 1: Write the failing test**

Add to `tests/config/index.test.ts` (or create if needed):

```ts
import { describe, it, expect } from 'bun:test'
import { defaultConfig } from '../../src/config/defaults'

describe('builtinSkills config', () => {
  it('defaults builtinSkills to empty object', () => {
    expect(defaultConfig.builtinSkills).toEqual({})
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config`
Expected: FAIL — `builtinSkills` property doesn't exist

**Step 3: Write minimal implementation**

In `src/config/types.ts`, add to `RaConfig` interface after line 39 (`builtinTools: boolean`):

```ts
builtinSkills: Record<string, boolean>
```

In `src/config/defaults.ts`, add after `builtinTools: true,` (line 38):

```ts
builtinSkills: {},
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/config`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/types.ts src/config/defaults.ts tests/config
git commit -m "feat: add builtinSkills config option"
```

---

### Task 2: Create the three built-in SKILL.md files

**Files:**
- Create: `src/skills/builtin/write-skill/SKILL.md`
- Create: `src/skills/builtin/write-recipe/SKILL.md`
- Create: `src/skills/builtin/write-middleware/SKILL.md`

**Step 1: Create `src/skills/builtin/write-skill/SKILL.md`**

```markdown
---
name: write-skill
description: How to author ra skills. Use when creating a new skill directory with SKILL.md, scripts, references, and assets.
---

# Writing a Skill

A skill is a directory containing a `SKILL.md` file with YAML frontmatter and a markdown body.

## Directory Structure

```
my-skill/
  SKILL.md              # Required — metadata + instructions
  scripts/              # Optional — executable files
    run.ts
  references/           # Optional — supporting docs
    REFERENCE.md
  assets/               # Optional — data files
    template.json
```

## SKILL.md Format

The `SKILL.md` file has YAML frontmatter followed by a markdown body:

```yaml
---
name: my-skill            # Required — must match directory name exactly
description: Short desc   # Required — shown in available_skills list
license: MIT              # Optional
compatibility: ra>=1.0    # Optional
metadata:                 # Optional — custom key-value pairs
  category: coding
---
```

The markdown body after the frontmatter contains instructions for the model. This is what gets injected when the skill is activated.

## Key Rules

- The `name` field MUST match the directory name exactly, or the skill won't load
- Keep the `description` concise — it's shown in discovery, not the full body
- The body should contain actionable instructions: process steps, principles, output formats
- Scripts are never auto-executed — the model decides when to run them via tools
- Skills are loaded from directories listed in `skillDirs` config or installed via `ra skill install`

## Scripts

Scripts in `scripts/` support multiple runtimes. The runner detects the runtime via:
1. Shebang line (e.g., `#!/usr/bin/env python3`)
2. File extension fallback (`.sh`, `.py`, `.go`, `.js`, `.ts`)

## Activation

Skills can be activated in three ways:
1. **Always-on** — Listed in `config.skills` or passed via `--skill <name>`
2. **Available** — Discovered from `skillDirs`, shown in `<available_skills>` XML
3. **REPL command** — `/skill <name>` injects skill before next message
```

**Step 2: Create `src/skills/builtin/write-recipe/SKILL.md`**

```markdown
---
name: write-recipe
description: How to create ra recipes — complete agent configurations with skills, middleware, and config.
---

# Writing a Recipe

A recipe is a self-contained agent configuration directory. It bundles a config file, skills, and middleware into a portable package.

## Directory Structure

```
my-recipe/
  ra.config.yml          # Required — ra configuration
  skills/                # Optional — recipe-specific skills
    my-skill/
      SKILL.md
  middleware/             # Optional — recipe-specific middleware
    logger.ts
  system-prompt.md       # Optional — referenced from config
```

## Config File

The `ra.config.yml` (or `.json`/`.toml`) configures the agent:

```yaml
provider: anthropic
model: claude-sonnet-4-6
systemPrompt: ./system-prompt.md

skillDirs:
  - ./skills

skills:
  - my-skill          # Always-on skills for this recipe

middleware:
  beforeModelCall:
    - ./middleware/logger.ts

maxIterations: 50
builtinTools: true
```

## Key Rules

- Recipes are run by pointing ra at the directory: `ra --config my-recipe/ra.config.yml`
- Use relative paths in the config — they resolve relative to the config file location
- `skillDirs` lists directories where skills are loaded from
- `skills` lists which loaded skills are always-on (full body injected)
- Skills not in the `skills` list are still discoverable via `<available_skills>`
- Middleware hooks are TypeScript files exporting async handler functions

## System Prompt

Reference a file for the system prompt to keep the config clean:

```yaml
systemPrompt: ./system-prompt.md
```

The file path is resolved relative to the config file. If the value doesn't look like a path, it's used as literal text.

## Testing a Recipe

```bash
# Interactive mode
ra --config my-recipe/ra.config.yml

# One-shot
ra --config my-recipe/ra.config.yml "Hello, agent"
```
```

**Step 3: Create `src/skills/builtin/write-middleware/SKILL.md`**

```markdown
---
name: write-middleware
description: How to write ra middleware hooks for the agent loop lifecycle.
---

# Writing Middleware

Middleware hooks into the agent loop lifecycle. Each hook is an async function that receives a context object.

## Available Hooks

| Hook | Context | When |
|------|---------|------|
| `beforeLoopBegin` | `{ messages }` | Before the loop starts |
| `beforeModelCall` | `{ messages, tools }` | Before each LLM call |
| `onStreamChunk` | `{ chunk }` | On each streamed token/event |
| `afterModelResponse` | `{ messages, response }` | After LLM responds |
| `beforeToolExecution` | `{ toolCall, messages }` | Before a tool runs |
| `afterToolExecution` | `{ toolCall, result, messages }` | After a tool completes |
| `afterLoopIteration` | `{ messages, iterationCount }` | After each loop iteration |
| `afterLoopComplete` | `{ messages, iterationCount }` | When the loop finishes |

## File Format

Each middleware file exports a default object mapping hook names to handler functions:

```typescript
import type { MiddlewareConfig } from 'ra'

export default {
  beforeModelCall: [
    async (ctx) => {
      console.log(`Calling model with ${ctx.messages.length} messages`)
    }
  ],
  afterToolExecution: [
    async (ctx) => {
      console.log(`Tool ${ctx.toolCall.name} completed`)
    }
  ],
} satisfies Partial<MiddlewareConfig>
```

## Configuration

Reference middleware files in `ra.config.yml`:

```yaml
middleware:
  beforeModelCall:
    - ./middleware/logger.ts
  afterToolExecution:
    - ./middleware/tracker.ts
```

Each hook maps to an array of file paths. Multiple handlers per hook run in order.

## Key Rules

- Handlers are async functions — always use `async`
- Handlers receive a typed context object specific to the hook
- Multiple handlers per hook run sequentially in array order
- Middleware from config is merged with any programmatic middleware
- Use relative paths in config — they resolve relative to the config file
- Don't mutate `ctx.messages` directly unless you intend to alter the conversation
```

**Step 4: Verify the SKILL.md files have valid frontmatter**

No automated test needed — Task 3's test will validate loading.

**Step 5: Commit**

```bash
git add src/skills/builtin/
git commit -m "feat: add built-in skill SKILL.md files"
```

---

### Task 3: Create `loadBuiltinSkills()` function

**Files:**
- Create: `src/skills/builtin.ts`
- Create: `tests/skills/builtin.test.ts`

**Step 1: Write the failing test**

Create `tests/skills/builtin.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { loadBuiltinSkills } from '../../src/skills/builtin'

describe('loadBuiltinSkills', () => {
  it('loads all three built-in skills', () => {
    const skills = loadBuiltinSkills()
    expect(skills.has('write-skill')).toBe(true)
    expect(skills.has('write-recipe')).toBe(true)
    expect(skills.has('write-middleware')).toBe(true)
  })

  it('each skill has metadata and body', () => {
    const skills = loadBuiltinSkills()
    for (const [name, skill] of skills) {
      expect(skill.metadata.name).toBe(name)
      expect(skill.metadata.description).toBeTruthy()
      expect(skill.body).toBeTruthy()
    }
  })

  it('filters out disabled skills', () => {
    const skills = loadBuiltinSkills({ 'write-skill': false })
    expect(skills.has('write-skill')).toBe(false)
    expect(skills.has('write-recipe')).toBe(true)
    expect(skills.has('write-middleware')).toBe(true)
  })

  it('returns all skills when config is empty object', () => {
    const skills = loadBuiltinSkills({})
    expect(skills.size).toBe(3)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/skills/builtin.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/skills/builtin.ts`:

```ts
import yaml from 'js-yaml'
import type { Skill, SkillMetadata } from './types'

// Import SKILL.md files at build time — embedded in binary
import writeSkillMd from './builtin/write-skill/SKILL.md' with { type: 'text' }
import writeRecipeMd from './builtin/write-recipe/SKILL.md' with { type: 'text' }
import writeMiddlewareMd from './builtin/write-middleware/SKILL.md' with { type: 'text' }

interface BuiltinEntry {
  name: string
  content: string
}

const BUILTIN_SKILLS: BuiltinEntry[] = [
  { name: 'write-skill', content: writeSkillMd },
  { name: 'write-recipe', content: writeRecipeMd },
  { name: 'write-middleware', content: writeMiddlewareMd },
]

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  const frontmatter = (yaml.load(match[1]!) as Record<string, unknown>) ?? {}
  return { frontmatter, body: match[2] ?? '' }
}

export function loadBuiltinSkills(config: Record<string, boolean> = {}): Map<string, Skill> {
  const result = new Map<string, Skill>()

  for (const entry of BUILTIN_SKILLS) {
    // Skip if explicitly disabled
    if (config[entry.name] === false) continue

    const { frontmatter, body } = parseFrontmatter(entry.content)
    const metadata: SkillMetadata = {
      name: (frontmatter['name'] as string) ?? entry.name,
      description: (frontmatter['description'] as string) ?? '',
    }

    result.set(entry.name, {
      metadata,
      body,
      dir: `builtin:${entry.name}`,
      scripts: [],
      references: [],
      assets: [],
    })
  }

  return result
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/skills/builtin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/builtin.ts tests/skills/builtin.test.ts
git commit -m "feat: add loadBuiltinSkills function"
```

---

### Task 4: Integrate built-in skills into `src/index.ts`

**Files:**
- Modify: `src/index.ts:10,210`

**Step 1: Write the failing test**

This is an integration-level change. We'll verify via the existing loader test pattern. Add to `tests/skills/builtin.test.ts`:

```ts
import { buildAvailableSkillsXml } from '../../src/skills/loader'

describe('built-in skills integration with available_skills XML', () => {
  it('built-in skills appear in available_skills XML', () => {
    const skills = loadBuiltinSkills()
    const xml = buildAvailableSkillsXml(skills)
    expect(xml).toContain('<name>write-skill</name>')
    expect(xml).toContain('<name>write-recipe</name>')
    expect(xml).toContain('<name>write-middleware</name>')
  })

  it('built-in skills location uses builtin: prefix', () => {
    const skills = loadBuiltinSkills()
    const xml = buildAvailableSkillsXml(skills)
    expect(xml).toContain('<location>builtin:write-skill/SKILL.md</location>')
  })
})
```

**Step 2: Run test to verify it passes** (this should already pass from Task 3)

Run: `bun test tests/skills/builtin.test.ts`
Expected: PASS

**Step 3: Write the integration code**

In `src/index.ts`:

Add import after line 10 (`import { loadSkills } from './skills/loader'`):

```ts
import { loadBuiltinSkills } from './skills/builtin'
```

After line 210 (`const skillMap = await loadSkills(config.skillDirs)`), add:

```ts
// Merge built-in skills (user skills override built-in if same name)
const builtinSkills = loadBuiltinSkills(config.builtinSkills)
for (const [name, skill] of builtinSkills) {
  if (!skillMap.has(name)) skillMap.set(name, skill)
}
```

**Step 4: Run all tests**

Run: `bun test`
Expected: All PASS

**Step 5: Type check**

Run: `bun tsc`
Expected: No errors

**Step 6: Commit**

```bash
git add src/index.ts tests/skills/builtin.test.ts
git commit -m "feat: integrate built-in skills into agent startup"
```

---

### Task 5: Manual smoke test

**Step 1: Run ra in REPL and verify built-in skills appear**

```bash
bun run src/index.ts --repl
```

Type any message and check that the model can see `write-skill`, `write-recipe`, `write-middleware` in its available skills.

**Step 2: Verify disabling works**

Create a test config:

```yaml
builtinSkills:
  write-skill: false
```

Run with `--config` and verify `write-skill` is not in available skills.

**Step 3: Commit (no code changes expected)**

If any fixes needed, commit them individually.

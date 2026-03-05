# Context Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-discover project context files (CLAUDE.md, .cursorrules, etc.) and inject them as user messages before the prompt.

**Architecture:** New `src/context/` module with discovery (walk cwd→git root, glob match), injection (wrap in XML tags, one user message per file), and config integration. CLI `--show-context` flag and REPL `/context` command for inspection.

**Tech Stack:** Bun APIs (Bun.file, Bun.Glob), existing config/types system

---

### Task 1: Add context types and config

**Files:**
- Create: `src/context/types.ts`
- Modify: `src/config/types.ts:10-46`
- Modify: `src/config/defaults.ts:1-43`

**Step 1: Write the failing test**

Create `tests/context/discovery.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import type { ContextConfig, ContextFile } from '../../src/context/types'

describe('context types', () => {
  it('ContextConfig has expected shape', () => {
    const config: ContextConfig = {
      enabled: true,
      patterns: ['CLAUDE.md', '.cursorrules'],
      ignore: [],
    }
    expect(config.enabled).toBe(true)
    expect(config.patterns).toHaveLength(2)
  })

  it('ContextFile has expected shape', () => {
    const file: ContextFile = {
      path: '/project/CLAUDE.md',
      relativePath: 'CLAUDE.md',
      content: '# Instructions',
    }
    expect(file.path).toBe('/project/CLAUDE.md')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/context/discovery.test.ts`
Expected: FAIL — cannot resolve `../../src/context/types`

**Step 3: Write the types**

Create `src/context/types.ts`:

```ts
export interface ContextConfig {
  enabled: boolean
  patterns: string[]
  ignore: string[]
}

export interface ContextFile {
  path: string
  relativePath: string
  content: string
}
```

**Step 4: Add to RaConfig**

In `src/config/types.ts`, add import and field:

```ts
import type { ContextConfig } from '../context/types'
```

Add to `RaConfig` interface:

```ts
context: ContextConfig
```

In `src/config/defaults.ts`, add to `defaultConfig`:

```ts
context: {
  enabled: true,
  patterns: [],
  ignore: [],
},
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/context/discovery.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/context/types.ts src/config/types.ts src/config/defaults.ts tests/context/discovery.test.ts
git commit -m "feat(context): add context discovery types and config"
```

---

### Task 2: Implement discovery — find git root and match files

**Files:**
- Create: `src/context/discovery.ts`
- Modify: `tests/context/discovery.test.ts`

**Step 1: Write the failing test**

Add to `tests/context/discovery.test.ts`:

```ts
import { discoverContextFiles } from '../../src/context/discovery'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach } from 'bun:test'

describe('discoverContextFiles', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-context-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
    // Init a git repo so git root detection works
    Bun.spawnSync(['git', 'init'], { cwd: tmp })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns empty array when no patterns match', async () => {
    const files = await discoverContextFiles({
      cwd: tmp,
      patterns: ['CLAUDE.md'],
      ignore: [],
    })
    expect(files).toEqual([])
  })

  it('finds a file in cwd', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), '# Instructions')
    const files = await discoverContextFiles({
      cwd: tmp,
      patterns: ['CLAUDE.md'],
      ignore: [],
    })
    expect(files).toHaveLength(1)
    expect(files[0].relativePath).toBe('CLAUDE.md')
    expect(files[0].content).toBe('# Instructions')
  })

  it('finds files in parent directories up to git root', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), 'root instructions')
    const sub = join(tmp, 'src', 'app')
    mkdirSync(sub, { recursive: true })
    const files = await discoverContextFiles({
      cwd: sub,
      patterns: ['CLAUDE.md'],
      ignore: [],
    })
    expect(files).toHaveLength(1)
    expect(files[0].content).toBe('root instructions')
  })

  it('finds files at multiple levels', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), 'root')
    const sub = join(tmp, 'src')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'CLAUDE.md'), 'src level')
    const files = await discoverContextFiles({
      cwd: sub,
      patterns: ['CLAUDE.md'],
      ignore: [],
    })
    expect(files).toHaveLength(2)
    // Closest first
    expect(files[0].content).toBe('src level')
    expect(files[1].content).toBe('root')
  })

  it('respects ignore list', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), 'instructions')
    writeFileSync(join(tmp, '.cursorrules'), 'rules')
    const files = await discoverContextFiles({
      cwd: tmp,
      patterns: ['CLAUDE.md', '.cursorrules'],
      ignore: ['.cursorrules'],
    })
    expect(files).toHaveLength(1)
    expect(files[0].relativePath).toBe('CLAUDE.md')
  })

  it('supports glob patterns like .cursor/rules/*', async () => {
    const rulesDir = join(tmp, '.cursor', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(rulesDir, 'typescript.mdc'), 'ts rules')
    writeFileSync(join(rulesDir, 'testing.mdc'), 'test rules')
    const files = await discoverContextFiles({
      cwd: tmp,
      patterns: ['.cursor/rules/*'],
      ignore: [],
    })
    expect(files).toHaveLength(2)
  })

  it('returns empty when disabled (caller responsibility, but test no crash)', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), 'instructions')
    const files = await discoverContextFiles({
      cwd: tmp,
      patterns: [],
      ignore: [],
    })
    expect(files).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/context/discovery.test.ts`
Expected: FAIL — cannot resolve `../../src/context/discovery`

**Step 3: Implement discovery**

Create `src/context/discovery.ts`:

```ts
import { join, relative } from 'path'
import type { ContextFile } from './types'

export interface DiscoverOptions {
  cwd: string
  patterns: string[]
  ignore: string[]
}

async function findGitRoot(cwd: string): Promise<string | null> {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}

export async function discoverContextFiles(options: DiscoverOptions): Promise<ContextFile[]> {
  const { cwd, patterns, ignore } = options
  if (patterns.length === 0) return []

  const gitRoot = await findGitRoot(cwd)
  const root = gitRoot ?? cwd

  // Collect directories from cwd up to root
  const dirs: string[] = []
  let current = cwd
  while (true) {
    dirs.push(current)
    if (current === root) break
    const parent = join(current, '..')
    if (parent === current) break // filesystem root
    current = parent
  }
  // If cwd was already root, dirs has just one entry; otherwise ensure root is included
  if (dirs[dirs.length - 1] !== root) dirs.push(root)

  const files: ContextFile[] = []
  const ignoreSet = new Set(ignore)

  for (const dir of dirs) {
    for (const pattern of patterns) {
      const glob = new Bun.Glob(pattern)
      for await (const match of glob.scan({ cwd: dir, absolute: false, onlyFiles: true })) {
        if (ignoreSet.has(match) || ignoreSet.has(pattern)) continue
        const absPath = join(dir, match)
        // Deduplicate — same absolute path could match from different dirs
        if (files.some(f => f.path === absPath)) continue
        const content = await Bun.file(absPath).text()
        files.push({
          path: absPath,
          relativePath: relative(root, absPath),
          content,
        })
      }
    }
  }

  return files
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/context/discovery.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/context/discovery.ts tests/context/discovery.test.ts
git commit -m "feat(context): implement context file discovery with git root walking"
```

---

### Task 3: Implement injection — format context files as user messages

**Files:**
- Create: `src/context/inject.ts`
- Create: `tests/context/inject.test.ts`

**Step 1: Write the failing test**

Create `tests/context/inject.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { buildContextMessages } from '../../src/context/inject'
import type { ContextFile } from '../../src/context/types'

describe('buildContextMessages', () => {
  it('returns empty array for no files', () => {
    const messages = buildContextMessages([])
    expect(messages).toEqual([])
  })

  it('creates one user message per file', () => {
    const files: ContextFile[] = [
      { path: '/p/CLAUDE.md', relativePath: 'CLAUDE.md', content: '# Instructions' },
      { path: '/p/.cursorrules', relativePath: '.cursorrules', content: 'rules here' },
    ]
    const messages = buildContextMessages(files)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('user')
  })

  it('wraps content in context-file XML tags with path', () => {
    const files: ContextFile[] = [
      { path: '/p/CLAUDE.md', relativePath: 'CLAUDE.md', content: '# Be helpful' },
    ]
    const messages = buildContextMessages(files)
    expect(messages[0].content).toBe(
      '<context-file path="CLAUDE.md">\n# Be helpful\n</context-file>'
    )
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/context/inject.test.ts`
Expected: FAIL — cannot resolve `../../src/context/inject`

**Step 3: Implement injection**

Create `src/context/inject.ts`:

```ts
import type { IMessage } from '../providers/types'
import type { ContextFile } from './types'

export function buildContextMessages(files: ContextFile[]): IMessage[] {
  return files.map(file => ({
    role: 'user' as const,
    content: `<context-file path="${file.relativePath}">\n${file.content}\n</context-file>`,
  }))
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/context/inject.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/context/inject.ts tests/context/inject.test.ts
git commit -m "feat(context): build user messages from discovered context files"
```

---

### Task 4: Create module index and integrate with CLI interface

**Files:**
- Create: `src/context/index.ts`
- Modify: `src/interfaces/cli.ts:1-76`

**Step 1: Create module index**

Create `src/context/index.ts`:

```ts
export { discoverContextFiles } from './discovery'
export { buildContextMessages } from './inject'
export type { ContextConfig, ContextFile } from './types'
export type { DiscoverOptions } from './discovery'
```

**Step 2: Integrate into CLI**

In `src/interfaces/cli.ts`, add to `CliOptions`:

```ts
contextMessages?: IMessage[]
```

In `runCli`, after building `initialMessages` with skills and before the user prompt push, insert context messages:

```ts
// Inject context-file messages before user prompt
if (options.contextMessages?.length) {
  initialMessages.push(...options.contextMessages)
}
```

This goes right before `initialMessages.push(...sessionMessages)` (line 55).

**Step 3: Run existing CLI tests to verify no regression**

Run: `bun test tests/interfaces/cli.test.ts`
Expected: PASS (contextMessages is optional, existing tests unaffected)

**Step 4: Commit**

```bash
git add src/context/index.ts src/interfaces/cli.ts
git commit -m "feat(context): create module index and add contextMessages to CLI"
```

---

### Task 5: Integrate discovery into main entry point

**Files:**
- Modify: `src/index.ts:1-322`

**Step 1: Add discovery call in main()**

In `src/index.ts`, add import:

```ts
import { discoverContextFiles, buildContextMessages } from './context'
```

After `const config = await loadConfig(...)` (line 164) and before `const middleware = ...` (line 171), add:

```ts
// Discover project context files
const contextMessages = config.context.enabled
  ? buildContextMessages(await discoverContextFiles({
      cwd: process.cwd(),
      patterns: config.context.patterns,
      ignore: config.context.ignore,
    }))
  : []
```

Pass `contextMessages` to `runCli`:

```ts
const cliResult = await runCli({
  ...existing options...,
  contextMessages,
})
```

**Step 2: Run full test suite to verify no regression**

Run: `bun test`
Expected: All existing tests PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(context): run discovery in main and pass to CLI interface"
```

---

### Task 6: Integrate with REPL — injection + /context command

**Files:**
- Modify: `src/interfaces/repl.ts:1-230`

**Step 1: Add contextMessages to ReplOptions and inject**

Add to `ReplOptions`:

```ts
contextMessages?: IMessage[]
```

In `processInput`, inject context messages into `initialMessages` — after system prompt, before conversation history. Add right before `initialMessages.push(...this.messages)`:

```ts
// Inject context-file messages on first turn
if (this.messages.length === 0 && this.options.contextMessages?.length) {
  initialMessages.push(...this.options.contextMessages)
}
```

**Step 2: Add /context command**

In `handleCommand`, add a new case:

```ts
case '/context': {
  if (!this.options.contextMessages?.length) return 'No context files discovered.'
  const lines = this.options.contextMessages.map(m => {
    const content = typeof m.content === 'string' ? m.content : ''
    const pathMatch = content.match(/<context-file path="([^"]+)">/)
    const path = pathMatch?.[1] ?? 'unknown'
    const size = content.length
    return `  ${path}  (${size} chars)`
  })
  return `Discovered context files:\n${lines.join('\n')}`
}
```

**Step 3: Pass contextMessages from main to Repl**

In `src/index.ts`, add `contextMessages` to the Repl constructor call:

```ts
const repl = new Repl({
  ...existing options...,
  contextMessages,
})
```

**Step 4: Run REPL tests**

Run: `bun test tests/interfaces/repl.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/interfaces/repl.ts src/index.ts
git commit -m "feat(context): inject context in REPL and add /context command"
```

---

### Task 7: Add --show-context CLI flag

**Files:**
- Modify: `src/interfaces/parse-args.ts:1-159`
- Modify: `src/index.ts`

**Step 1: Add flag to parse-args**

In `parse-args.ts`, add to `ParsedArgsMeta`:

```ts
showContext: boolean
```

Add to `utilParseArgs` options:

```ts
'show-context': { type: 'boolean' },
```

Add to meta return:

```ts
showContext: (values['show-context'] as boolean | undefined) ?? false,
```

**Step 2: Handle in main**

In `src/index.ts`, after context discovery and before interface selection, add:

```ts
if (parsed.meta.showContext) {
  if (contextMessages.length === 0) {
    console.log('No context files discovered.')
  } else {
    for (const msg of contextMessages) {
      const content = typeof msg.content === 'string' ? msg.content : ''
      console.log(content)
      console.log()
    }
  }
  await shutdown()
  process.exit(0)
}
```

**Step 3: Add to HELP string**

Add to the OPTIONS section:

```
  --show-context                      Show discovered context files and exit
```

**Step 4: Write test**

Add to `tests/config/parse-args.test.ts`:

```ts
it('parses --show-context flag', () => {
  const result = parseArgs(['bun', 'src/index.ts', '--show-context'])
  expect(result.meta.showContext).toBe(true)
})
```

**Step 5: Run tests**

Run: `bun test tests/config/parse-args.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/interfaces/parse-args.ts src/index.ts tests/config/parse-args.test.ts
git commit -m "feat(context): add --show-context CLI flag for inspection"
```

---

### Task 8: Wire context into HTTP interface

**Files:**
- Modify: `src/interfaces/http.ts`
- Modify: `src/index.ts`

**Step 1: Add contextMessages to HttpServer options and inject**

Same pattern as CLI/REPL — add `contextMessages?: IMessage[]` to `HttpServerOptions`, prepend to initial messages in request handling.

Pass `contextMessages` from main to HttpServer constructor.

**Step 2: Run HTTP tests**

Run: `bun test tests/interfaces/http.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/interfaces/http.ts src/index.ts
git commit -m "feat(context): inject context files into HTTP interface"
```

---

### Task 9: Update package exports and final verification

**Files:**
- Modify: `package.json` (add `./context` export if wildcard doesn't cover it)

**Step 1: Verify module is exported**

Check that `src/context/index.ts` is accessible via package exports. The existing wildcard `"./*"` in package.json should cover it.

**Step 2: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 3: Run TypeScript check**

Run: `bun tsc`
Expected: No errors

**Step 4: Manual smoke test**

```bash
# Create a test config with patterns
echo 'context:
  patterns:
    - CLAUDE.md' > /tmp/ra-test/ra.config.yaml
echo '# Be helpful' > /tmp/ra-test/CLAUDE.md

# Test --show-context
bun src/index.ts --config /tmp/ra-test/ra.config.yaml --show-context
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(context): final wiring and verification"
```

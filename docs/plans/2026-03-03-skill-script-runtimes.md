# Skill Script Runtime Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend `runSkillScript` to support `.py`, `.go`, `.sh`, `.js`, and `.ts` with shebang-first runtime dispatch and a node→bun→deno fallback for JS/TS.

**Architecture:** Two helpers added to `runner.ts`: `parseShebang` reads the first line for a `#!` binary, and `findRuntime` probes `Bun.which()` for available runtimes. `runSkillScript` uses shebang when present, otherwise dispatches by extension. Tests skip optional runtimes (python, go, deno, node) via `Bun.which` guards so CI always passes.

**Tech Stack:** Bun, TypeScript, `bun:test`, `spyOn` for mock-based runtime fallback tests.

---

### Task 1: Add `findRuntime` helper and rewrite dispatch

**Files:**
- Modify: `src/skills/runner.ts`

**Step 1: Write failing tests for new extension support**

In `tests/skills/runner.test.ts`, add these tests (they fail because the current code uses `sh` for `.py`/`.go` and always uses `bun` for JS/TS without shebang awareness):

```ts
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { runSkillScript } from '../../src/skills/runner'
import { mkdirSync, writeFileSync, rmSync } from 'fs'

const TEST_DIR = '/tmp/ra-test-runner'
const hasPython = !!Bun.which('python3') || !!Bun.which('python')
const hasGo     = !!Bun.which('go')
const hasNode   = !!Bun.which('node')
const hasDeno   = !!Bun.which('deno')

const ENV = { RA_PROMPT: 'test', RA_MODEL: 'claude', RA_PROVIDER: 'anthropic' }

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('runSkillScript - new runtimes', () => {
  it('runs .ts via bun (no shebang, default)', async () => {
    const p = `${TEST_DIR}/test.ts`
    writeFileSync(p, 'console.log("bun-ts")')
    expect((await runSkillScript(p, ENV)).trim()).toBe('bun-ts')
  })

  it('runs .js via bun shebang', async () => {
    const p = `${TEST_DIR}/test.js`
    writeFileSync(p, '#!/usr/bin/env bun\nconsole.log("bun-js")')
    expect((await runSkillScript(p, ENV)).trim()).toBe('bun-js')
  })

  ;(hasPython ? it : it.skip)('runs .py script', async () => {
    const p = `${TEST_DIR}/test.py`
    writeFileSync(p, 'print("hello-py")')
    expect((await runSkillScript(p, ENV)).trim()).toBe('hello-py')
  })

  ;(hasGo ? it : it.skip)('runs .go script', async () => {
    const p = `${TEST_DIR}/test.go`
    writeFileSync(p, `package main\nimport "fmt"\nfunc main() { fmt.Println("hello-go") }`)
    expect((await runSkillScript(p, ENV)).trim()).toBe('hello-go')
  })

  ;(hasNode ? it : it.skip)('runs .js via node shebang', async () => {
    const p = `${TEST_DIR}/node.js`
    writeFileSync(p, `#!/usr/bin/env node\nconsole.log("node-js")`)
    expect((await runSkillScript(p, ENV)).trim()).toBe('node-js')
  })

  ;(hasDeno ? it : it.skip)('runs .ts via deno shebang', async () => {
    const p = `${TEST_DIR}/deno.ts`
    writeFileSync(p, `#!/usr/bin/env deno\nconsole.log("deno-ts")`)
    expect((await runSkillScript(p, ENV)).trim()).toBe('deno-ts')
  })

  it('throws on unknown extension', async () => {
    const p = `${TEST_DIR}/test.rb`
    writeFileSync(p, 'puts "hi"')
    expect(runSkillScript(p, ENV)).rejects.toThrow('Unsupported script extension')
  })
})

describe('runSkillScript - shebang override', () => {
  it('shebang overrides extension default: .js with #!/usr/bin/env bun prints bun version', async () => {
    const p = `${TEST_DIR}/shebang.js`
    writeFileSync(p, '#!/usr/bin/env bun\nprocess.stdout.write(process.versions.bun ?? "none")')
    const out = await runSkillScript(p, ENV)
    expect(out).not.toBe('none')  // bun version string present
  })
})

describe('runSkillScript - runtime fallback', () => {
  it('falls back from node to bun when node is absent', async () => {
    const p = `${TEST_DIR}/fallback.js`
    writeFileSync(p, 'process.stdout.write(process.versions.bun ?? "none")')

    const spy = spyOn(Bun, 'which').mockImplementation((name: string) => {
      if (name === 'node') return null
      if (name === 'bun') return '/usr/bin/bun'
      return null
    })
    try {
      const out = await runSkillScript(p, ENV)
      expect(out).not.toBe('none')
    } finally {
      spy.mockRestore()
    }
  })

  it('throws when no JS runtime is available', async () => {
    const p = `${TEST_DIR}/nort.js`
    writeFileSync(p, 'console.log("x")')

    const spy = spyOn(Bun, 'which').mockReturnValue(null)
    try {
      await expect(runSkillScript(p, ENV)).rejects.toThrow('None of')
    } finally {
      spy.mockRestore()
    }
  })
})
```

**Step 2: Run tests to confirm they fail**

```bash
bun test tests/skills/runner.test.ts
```

Expected: failures on `.py`, `.go`, unknown extension, shebang-override, fallback tests.

**Step 3: Rewrite `src/skills/runner.ts`**

Replace the file entirely:

```ts
import { join } from 'path'
import type { IMessage } from '../providers/types'
import type { Skill } from './types'

/**
 * Parse the shebang binary from the first line of a script.
 * #!/usr/bin/env node  -> 'node'
 * #!/usr/bin/bun       -> 'bun'
 * Returns null if no shebang present.
 */
function parseShebang(content: string): string | null {
  const firstLine = content.split('\n')[0]
  if (!firstLine.startsWith('#!')) return null
  const parts = firstLine.slice(2).trim().split(/\s+/)
  if (parts[0]?.endsWith('env') && parts[1]) return parts[1]
  return parts[0]?.split('/').pop() ?? null
}

/**
 * Find the first available binary from candidates via Bun.which.
 * Throws if none found.
 */
function findRuntime(candidates: string[]): string {
  for (const c of candidates) {
    if (Bun.which(c)) return c
  }
  throw new Error(`None of [${candidates.join(', ')}] found on PATH`)
}

/**
 * Build the subprocess command for a given runtime and script path.
 */
function buildCmd(runtime: string, scriptPath: string): string[] {
  switch (runtime) {
    case 'deno': return ['deno', 'run', scriptPath]
    case 'bun':  return ['bun', 'run', scriptPath]
    case 'go':   return ['go', 'run', scriptPath]
    default:     return [runtime, scriptPath]
  }
}

/**
 * Resolve the command to run a script.
 * Shebang takes priority; falls back to extension-based defaults.
 */
async function resolveCmd(scriptPath: string): Promise<string[]> {
  const content = await Bun.file(scriptPath).text()
  const shebang = parseShebang(content)
  if (shebang) return buildCmd(shebang, scriptPath)

  const ext = scriptPath.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'sh':  return ['sh', scriptPath]
    case 'py':  return buildCmd(findRuntime(['python3', 'python']), scriptPath)
    case 'go':  return ['go', 'run', scriptPath]
    case 'js':
    case 'ts':  return buildCmd(findRuntime(['node', 'bun', 'deno']), scriptPath)
    default:    throw new Error(`Unsupported script extension: .${ext ?? ''}`)
  }
}

export async function runSkillScript(scriptPath: string, env: Record<string, string>): Promise<string> {
  const cmd = await resolveCmd(scriptPath)
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  const [output, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])

  if (exitCode !== 0) {
    throw new Error(`Script exited with code ${exitCode}: ${(await new Response(proc.stderr).text()).trim()}`)
  }
  return output
}

export async function buildSkillMessages(skill: Skill, env: Record<string, string>): Promise<IMessage[]> {
  const messages: IMessage[] = [{ role: 'user', content: skill.body }]
  for (const rel of skill.scripts) {
    const output = await runSkillScript(join(skill.dir, rel), env)
    if (output.trim()) messages.push({ role: 'user', content: output })
  }
  return messages
}
```

**Step 4: Run all tests to confirm they pass**

```bash
bun test tests/skills/runner.test.ts
```

Expected: all non-skipped tests PASS. Skipped tests show as skipped (not failed).

Also run the full suite to confirm no regressions:

```bash
bun test
```

Expected: all tests pass (skipped ones are fine).

**Step 5: Commit**

```bash
git add src/skills/runner.ts tests/skills/runner.test.ts
git commit -m "feat: multi-runtime skill script support with shebang detection and fallback"
```

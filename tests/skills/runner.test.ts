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

describe('runSkillScript - existing behavior', () => {
  it('runs a .sh script and captures stdout', async () => {
    const p = `${TEST_DIR}/test.sh`
    writeFileSync(p, '#!/bin/sh\necho "hello from shell"', { mode: 0o755 })
    expect((await runSkillScript(p, ENV)).trim()).toBe('hello from shell')
  })

  it('runs a .ts script via bun and captures stdout', async () => {
    const p = `${TEST_DIR}/test.ts`
    writeFileSync(p, 'console.log("hello from ts")')
    expect((await runSkillScript(p, ENV)).trim()).toBe('hello from ts')
  })

  it('passes env vars to script', async () => {
    const p = `${TEST_DIR}/env.sh`
    writeFileSync(p, '#!/bin/sh\necho $RA_PROMPT', { mode: 0o755 })
    expect((await runSkillScript(p, ENV)).trim()).toBe('test')
  })

  it('throws on non-zero exit', async () => {
    const p = `${TEST_DIR}/fail.sh`
    writeFileSync(p, '#!/bin/sh\nexit 1', { mode: 0o755 })
    await expect(runSkillScript(p, ENV)).rejects.toThrow('Script exited with code 1')
  })
})

describe('runSkillScript - new runtimes', () => {
  it('runs .ts via bun (no shebang, bun is the default fallback)', async () => {
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
    await expect(runSkillScript(p, ENV)).rejects.toThrow('Unsupported script extension')
  })
})

describe('runSkillScript - shebang override', () => {
  it('shebang #!/usr/bin/env bun on .js file uses bun (process.versions.bun is set)', async () => {
    const p = `${TEST_DIR}/shebang.js`
    writeFileSync(p, '#!/usr/bin/env bun\nprocess.stdout.write(process.versions.bun ?? "none")')
    const out = await runSkillScript(p, ENV)
    expect(out).not.toBe('none')
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

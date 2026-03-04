import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { runSkillScript, runSkillScriptByName } from '../../src/skills/runner'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from '../tmpdir'

const TEST_DIR = tmpdir('ra-test-runner')
const hasPython = !!Bun.which('python3') || !!Bun.which('python')
const hasGo     = !!Bun.which('go') && Bun.spawnSync(['go', 'version']).exitCode === 0

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

  it('captures stderr content in error message for failing scripts', async () => {
    const p = `${TEST_DIR}/stderr.sh`
    writeFileSync(p, '#!/bin/sh\necho "error details" >&2\nexit 1', { mode: 0o755 })
    await expect(runSkillScript(p, ENV)).rejects.toThrow('error details')
  })
})

describe('runSkillScript - new runtimes', () => {
  ;(hasPython ? it : it.skip)('runs .py script', async () => {
    const p = `${TEST_DIR}/test.py`
    writeFileSync(p, 'print("hello-py")')
    expect((await runSkillScript(p, ENV)).trim()).toBe('hello-py')
  })

  ;(hasGo ? it : it.skip)('runs .go script', async () => {
    const p = `${TEST_DIR}/test.go`
    writeFileSync(p, `package main\nimport "fmt"\nfunc main() { fmt.Println("hello-go") }`)
    expect((await runSkillScript(p, ENV)).trim()).toBe('hello-go')
  }, 15_000)

  it('throws on unknown extension', async () => {
    const p = `${TEST_DIR}/test.rb`
    writeFileSync(p, 'puts "hi"')
    await expect(runSkillScript(p, ENV)).rejects.toThrow('Unsupported script extension')
  })

  it('runs extensionless files via bash', async () => {
    const p = `${TEST_DIR}/myscript`
    writeFileSync(p, 'echo "no-ext"')
    expect((await runSkillScript(p, ENV)).trim()).toBe('no-ext')
  })
})

describe('runSkillScript - shebang handling', () => {
  it('files with shebangs are run via bash/sh', async () => {
    const p = `${TEST_DIR}/shebang.sh`
    writeFileSync(p, '#!/bin/sh\necho "shebang-works"')
    const out = await runSkillScript(p, ENV)
    expect(out.trim()).toBe('shebang-works')
  })

  it('shebang with env invocation works via bash', async () => {
    const p = `${TEST_DIR}/shebang2.sh`
    writeFileSync(p, '#!/usr/bin/env bash\necho "env-bash"')
    const out = await runSkillScript(p, ENV)
    expect(out.trim()).toBe('env-bash')
  })
})

describe('runSkillScript - runtime fallback', () => {
  ;(Bun.which('node') ? it : it.skip)('falls back from bun to node when bun is absent', async () => {
    const p = `${TEST_DIR}/fallback.js`
    writeFileSync(p, 'process.stdout.write("ok")')

    const nodePath = Bun.which('node')
    const spy = spyOn(Bun, 'which').mockImplementation((name: string) => {
      if (name === 'bun') return null
      if (name === 'node') return nodePath
      return null
    })
    try {
      const out = await runSkillScript(p, ENV)
      expect(out.trim()).toBe('ok')
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to --exec when no JS runtime is available', async () => {
    const p = `${TEST_DIR}/nort.js`
    writeFileSync(p, 'console.log("exec-fallback")')

    const spy = spyOn(Bun, 'which').mockReturnValue(null)
    try {
      const out = await runSkillScript(p, ENV)
      expect(out.trim()).toBe('exec-fallback')
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to --exec with module imports when no JS runtime is available', async () => {
    const p = `${TEST_DIR}/with-import.ts`
    writeFileSync(p, 'import { join } from "path"\nconsole.log(join("hello", "world"))')

    const spy = spyOn(Bun, 'which').mockReturnValue(null)
    try {
      const out = await runSkillScript(p, ENV)
      expect(out.trim()).toBe('hello/world')
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to --exec for .ts files when no JS runtime is available', async () => {
    const p = `${TEST_DIR}/nort.ts`
    writeFileSync(p, 'const msg: string = "exec-ts-fallback"\nconsole.log(msg)')

    const spy = spyOn(Bun, 'which').mockReturnValue(null)
    try {
      const out = await runSkillScript(p, ENV)
      expect(out.trim()).toBe('exec-ts-fallback')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('runSkillScriptByName', () => {
  it('runs a script by short name', async () => {
    mkdirSync(`${TEST_DIR}/scripts`, { recursive: true })
    writeFileSync(`${TEST_DIR}/scripts/gather.sh`, '#!/bin/sh\necho "gathered"', { mode: 0o755 })

    const skill = {
      metadata: { name: 'review', description: '' },
      body: 'Body',
      dir: TEST_DIR,
      scripts: ['scripts/gather.sh'],
      references: [],
      assets: [],
    }
    const output = await runSkillScriptByName(skill, 'gather.sh', ENV)
    expect(output.trim()).toBe('gathered')
  })

  it('runs a script by full relative path', async () => {
    mkdirSync(`${TEST_DIR}/scripts`, { recursive: true })
    writeFileSync(`${TEST_DIR}/scripts/gather.sh`, '#!/bin/sh\necho "gathered"', { mode: 0o755 })

    const skill = {
      metadata: { name: 'review', description: '' },
      body: 'Body',
      dir: TEST_DIR,
      scripts: ['scripts/gather.sh'],
      references: [],
      assets: [],
    }
    const output = await runSkillScriptByName(skill, 'scripts/gather.sh', ENV)
    expect(output.trim()).toBe('gathered')
  })

  it('throws for nonexistent script', async () => {
    const skill = {
      metadata: { name: 'review', description: '' },
      body: 'Body',
      dir: TEST_DIR,
      scripts: [],
      references: [],
      assets: [],
    }
    await expect(runSkillScriptByName(skill, 'nonexistent.sh', ENV)).rejects.toThrow('Script not found')
  })
})

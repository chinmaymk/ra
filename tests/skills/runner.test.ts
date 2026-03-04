import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { runSkillScript, buildSkillMessages } from '../../src/skills/runner'
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

  it('shebang takes priority over extension: .py file with #!/usr/bin/env bun runs via bun', async () => {
    const p = `${TEST_DIR}/shebang.py`
    writeFileSync(p, '#!/usr/bin/env bun\nprocess.stdout.write(process.versions.bun ?? "none")')
    const out = await runSkillScript(p, ENV)
    expect(out).not.toBe('none')
  })
})

describe('runSkillScript - runtime fallback', () => {
  ;(hasNode ? it : it.skip)('falls back from bun to node when bun is absent', async () => {
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

describe('buildSkillMessages', () => {
  it('returns body as first user message', async () => {
    const skill = {
      metadata: { name: 'test', description: '' },
      body: 'Do the thing',
      dir: TEST_DIR,
      scripts: [],
      references: [],
      assets: [],
    }
    const messages = await buildSkillMessages(skill, ENV)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe('user')
    expect(messages[0]!.content).toBe('Do the thing')
  })

  it('appends script output as additional user messages', async () => {
    writeFileSync(`${TEST_DIR}/info.sh`, '#!/bin/sh\necho "script output"', { mode: 0o755 })

    const skill = {
      metadata: { name: 'test', description: '' },
      body: 'Skill body',
      dir: TEST_DIR,
      scripts: ['info.sh'],
      references: [],
      assets: [],
    }
    const messages = await buildSkillMessages(skill, ENV)
    expect(messages).toHaveLength(2)
    expect(messages[0]!.content).toBe('Skill body')
    expect(messages[1]!.content.toString().trim()).toBe('script output')
  })

  it('skips empty script output', async () => {
    writeFileSync(`${TEST_DIR}/empty.sh`, '#!/bin/sh\n# no output', { mode: 0o755 })

    const skill = {
      metadata: { name: 'test', description: '' },
      body: 'Skill body',
      dir: TEST_DIR,
      scripts: ['empty.sh'],
      references: [],
      assets: [],
    }
    const messages = await buildSkillMessages(skill, ENV)
    expect(messages).toHaveLength(1) // Only the body, no script output
  })

  it('runs multiple scripts and appends each output', async () => {
    writeFileSync(`${TEST_DIR}/a.sh`, '#!/bin/sh\necho "output A"', { mode: 0o755 })
    writeFileSync(`${TEST_DIR}/b.sh`, '#!/bin/sh\necho "output B"', { mode: 0o755 })

    const skill = {
      metadata: { name: 'test', description: '' },
      body: 'Skill body',
      dir: TEST_DIR,
      scripts: ['a.sh', 'b.sh'],
      references: [],
      assets: [],
    }
    const messages = await buildSkillMessages(skill, ENV)
    expect(messages).toHaveLength(3)
    expect(messages[1]!.content.toString().trim()).toBe('output A')
    expect(messages[2]!.content.toString().trim()).toBe('output B')
  })
})

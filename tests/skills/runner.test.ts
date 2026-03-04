import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { runSkillScript } from '../../src/skills/runner'
import { mkdirSync, writeFileSync, rmSync } from 'fs'

const TEST_DIR = '/tmp/ra-test-runner'

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('runSkillScript', () => {
  it('runs a .sh script and captures stdout', async () => {
    const scriptPath = `${TEST_DIR}/test.sh`
    writeFileSync(scriptPath, '#!/bin/sh\necho "hello from shell"', { mode: 0o755 })
    const result = await runSkillScript(scriptPath, { RA_PROMPT: 'test', RA_MODEL: 'claude', RA_PROVIDER: 'anthropic' })
    expect(result.trim()).toBe('hello from shell')
  })

  it('runs a .ts script via bun and captures stdout', async () => {
    const scriptPath = `${TEST_DIR}/test.ts`
    writeFileSync(scriptPath, 'console.log("hello from ts")')
    const result = await runSkillScript(scriptPath, { RA_PROMPT: 'test', RA_MODEL: 'claude', RA_PROVIDER: 'anthropic' })
    expect(result.trim()).toBe('hello from ts')
  })

  it('passes env vars to script', async () => {
    const scriptPath = `${TEST_DIR}/env.sh`
    writeFileSync(scriptPath, '#!/bin/sh\necho $RA_PROMPT', { mode: 0o755 })
    const result = await runSkillScript(scriptPath, { RA_PROMPT: 'my-prompt', RA_MODEL: 'x', RA_PROVIDER: 'y' })
    expect(result.trim()).toBe('my-prompt')
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../../src/config'
import { defaultConfig } from '../../src/config/defaults'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('loadConfig', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-config-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig({ cwd: tmp })
    expect(config.provider).toBe(defaultConfig.provider)
    expect(config.model).toBe(defaultConfig.model)
    expect(config.interface).toBe('repl')
    expect(config.maxIterations).toBe(50)
  })

  it('merges CLI args over defaults', async () => {
    const config = await loadConfig({
      cwd: tmp,
      cliArgs: { provider: 'openai', model: 'gpt-4o', maxIterations: 10 },
    })
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
    expect(config.maxIterations).toBe(10)
    // defaults still present for unset fields
    expect(config.interface).toBe('repl')
  })

  it('resolves systemPrompt from file path', async () => {
    const promptFile = join(tmp, 'prompt.txt')
    writeFileSync(promptFile, 'You are a pirate.')
    const config = await loadConfig({
      cwd: tmp,
      cliArgs: { systemPrompt: promptFile },
    })
    expect(config.systemPrompt).toBe('You are a pirate.')
  })

  it('loads JSON config file', async () => {
    writeFileSync(
      join(tmp, 'ra.config.json'),
      JSON.stringify({ provider: 'google', maxIterations: 25 })
    )
    const config = await loadConfig({ cwd: tmp })
    expect(config.provider).toBe('google')
    expect(config.maxIterations).toBe(25)
  })

  it('loads YAML config file', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), 'provider: ollama\nmodel: llama3\n')
    const config = await loadConfig({ cwd: tmp })
    expect(config.provider).toBe('ollama')
    expect(config.model).toBe('llama3')
  })

  it('loads TOML config file', async () => {
    writeFileSync(join(tmp, 'ra.config.toml'), 'provider = "openai"\nmaxIterations = 5\n')
    const config = await loadConfig({ cwd: tmp })
    expect(config.provider).toBe('openai')
    expect(config.maxIterations).toBe(5)
  })

  it('env vars override config file', async () => {
    writeFileSync(
      join(tmp, 'ra.config.json'),
      JSON.stringify({ provider: 'google' })
    )
    const config = await loadConfig({
      cwd: tmp,
      env: { RA_PROVIDER: 'openai', RA_MODEL: 'gpt-4o' },
    })
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
  })

  it('CLI args override env vars', async () => {
    const config = await loadConfig({
      cwd: tmp,
      env: { RA_PROVIDER: 'google' },
      cliArgs: { provider: 'ollama' },
    })
    expect(config.provider).toBe('ollama')
  })
})

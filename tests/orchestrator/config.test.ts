import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadOrchestratorConfig, discoverOrchestratorConfig } from '../../src/orchestrator/config'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('loadOrchestratorConfig', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-orch-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function writeConfig(name: string, content: string): string {
    const path = join(tmp, name)
    writeFileSync(path, content)
    return path
  }

  function writeAgentConfig(dir: string): void {
    mkdirSync(join(tmp, dir), { recursive: true })
    writeFileSync(join(tmp, dir, 'ra.config.yml'), 'provider: anthropic\nmodel: claude-sonnet-4-6\n')
  }

  it('loads a valid YAML orchestrator config', async () => {
    writeAgentConfig('agents/coder')
    const path = writeConfig('ra.agents.yml', `
interface: repl
agents:
  coder:
    config: ./agents/coder/ra.config.yml
    default: true
`)
    const config = await loadOrchestratorConfig(path)
    expect(config.interface).toBe('repl')
    expect(config.agents.coder).toBeDefined()
    expect(config.agents.coder!.config).toBe('./agents/coder/ra.config.yml')
    expect(config.agents.coder!.default).toBe(true)
    expect(config.configDir).toBe(tmp)
  })

  it('loads a valid JSON orchestrator config', async () => {
    writeAgentConfig('agents/coder')
    const path = writeConfig('ra.agents.json', JSON.stringify({
      interface: 'http',
      agents: { coder: { config: './agents/coder/ra.config.yml' } },
    }))
    const config = await loadOrchestratorConfig(path)
    expect(config.interface).toBe('http')
  })

  it('sets defaults for optional fields', async () => {
    writeAgentConfig('agents/coder')
    const path = writeConfig('ra.agents.yml', `
interface: repl
agents:
  coder:
    config: ./agents/coder/ra.config.yml
`)
    const config = await loadOrchestratorConfig(path)
    expect(config.sessionsDir).toBe('./sessions')
    expect(config.skillDirs).toEqual([])
    expect(config.context.patterns).toEqual([])
  })

  it('throws when file does not exist', async () => {
    await expect(loadOrchestratorConfig(join(tmp, 'nope.yml'))).rejects.toThrow('not found')
  })

  it('throws when agent config file does not exist', async () => {
    const path = writeConfig('ra.agents.yml', `
interface: repl
agents:
  coder:
    config: ./nonexistent/ra.config.yml
`)
    await expect(loadOrchestratorConfig(path)).rejects.toThrow('config not found')
  })

  it('throws on unknown keys', async () => {
    writeAgentConfig('agents/coder')
    const path = writeConfig('ra.agents.yml', `
interface: repl
model: gpt-4
agents:
  coder:
    config: ./agents/coder/ra.config.yml
`)
    await expect(loadOrchestratorConfig(path)).rejects.toThrow('Unknown key "model"')
  })

  it('includes http config when present', async () => {
    writeAgentConfig('agents/coder')
    const path = writeConfig('ra.agents.yml', `
interface: http
http:
  port: 8080
  token: secret
agents:
  coder:
    config: ./agents/coder/ra.config.yml
`)
    const config = await loadOrchestratorConfig(path)
    expect(config.http).toEqual({ port: 8080, token: 'secret' })
  })
})

describe('discoverOrchestratorConfig', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-orch-discover-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns undefined when no config found', async () => {
    const result = await discoverOrchestratorConfig(tmp)
    expect(result).toBeUndefined()
  })

  it('discovers ra.agents.yml in the given directory', async () => {
    writeFileSync(join(tmp, 'ra.agents.yml'), 'interface: repl\nagents: {}')
    const result = await discoverOrchestratorConfig(tmp)
    expect(result).toBe(join(tmp, 'ra.agents.yml'))
  })

  it('discovers ra.agents.json in the given directory', async () => {
    writeFileSync(join(tmp, 'ra.agents.json'), '{}')
    const result = await discoverOrchestratorConfig(tmp)
    expect(result).toBe(join(tmp, 'ra.agents.json'))
  })

  it('walks up parent directories', async () => {
    const child = join(tmp, 'sub', 'deep')
    mkdirSync(child, { recursive: true })
    writeFileSync(join(tmp, 'ra.agents.yml'), 'interface: repl\nagents: {}')
    const result = await discoverOrchestratorConfig(child)
    expect(result).toBe(join(tmp, 'ra.agents.yml'))
  })
})

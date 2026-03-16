import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../src/config'
import { parseArgs } from '../src/interfaces/parse-args'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('multi-agent config', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-multi-agent-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('no agents key = single-agent mode (backward compatible)', async () => {
    writeFileSync(join(tmp, 'ra.config.yml'), 'provider: anthropic\nmodel: claude-sonnet-4-6\n')
    const c = await loadConfig({ cwd: tmp })
    expect(c.agents).toBeUndefined()
    expect(c.defaultAgent).toBeUndefined()
  })

  it('loads agents from ra.config.yml', async () => {
    // Create agent config files
    mkdirSync(join(tmp, 'agents', 'coder'), { recursive: true })
    mkdirSync(join(tmp, 'agents', 'reviewer'), { recursive: true })
    writeFileSync(join(tmp, 'agents', 'coder', 'ra.config.yml'), 'provider: anthropic\nmodel: claude-sonnet-4-6\n')
    writeFileSync(join(tmp, 'agents', 'reviewer', 'ra.config.yml'), 'provider: openai\nmodel: gpt-4o\n')

    writeFileSync(join(tmp, 'ra.config.yml'), [
      'provider: anthropic',
      'interface: repl',
      'agents:',
      '  coder: ./agents/coder/ra.config.yml',
      '  reviewer: ./agents/reviewer/ra.config.yml',
      'defaultAgent: coder',
    ].join('\n'))

    const c = await loadConfig({ cwd: tmp })
    expect(c.agents).toEqual({
      coder: './agents/coder/ra.config.yml',
      reviewer: './agents/reviewer/ra.config.yml',
    })
    expect(c.defaultAgent).toBe('coder')
  })

  it('discovers ra.agents.yml when no ra.config exists', async () => {
    mkdirSync(join(tmp, 'agents', 'coder'), { recursive: true })
    writeFileSync(join(tmp, 'agents', 'coder', 'ra.config.yml'), 'provider: anthropic\n')

    writeFileSync(join(tmp, 'ra.agents.yml'), [
      'interface: repl',
      'dataDir: .ra',
      'defaultAgent: coder',
      'agents:',
      '  coder: ./agents/coder/ra.config.yml',
    ].join('\n'))

    const c = await loadConfig({ cwd: tmp })
    expect(c.agents).toEqual({ coder: './agents/coder/ra.config.yml' })
    expect(c.defaultAgent).toBe('coder')
    expect(c.interface).toBe('repl')
  })

  it('ra.agents.json is also discovered', async () => {
    mkdirSync(join(tmp, 'agents', 'a'), { recursive: true })
    writeFileSync(join(tmp, 'agents', 'a', 'ra.config.json'), '{"provider":"anthropic"}')

    writeFileSync(join(tmp, 'ra.agents.json'), JSON.stringify({
      agents: { a: './agents/a/ra.config.json' },
      defaultAgent: 'a',
    }))

    const c = await loadConfig({ cwd: tmp })
    expect(c.agents).toEqual({ a: './agents/a/ra.config.json' })
    expect(c.defaultAgent).toBe('a')
  })

  it('agents in ra.config.yml take precedence over ra.agents.yml', async () => {
    mkdirSync(join(tmp, 'agents', 'a'), { recursive: true })
    mkdirSync(join(tmp, 'agents', 'b'), { recursive: true })
    writeFileSync(join(tmp, 'agents', 'a', 'ra.config.yml'), 'provider: anthropic\n')
    writeFileSync(join(tmp, 'agents', 'b', 'ra.config.yml'), 'provider: openai\n')

    // Both exist — agents in ra.config.yml should win
    writeFileSync(join(tmp, 'ra.config.yml'), [
      'agents:',
      '  a: ./agents/a/ra.config.yml',
    ].join('\n'))

    writeFileSync(join(tmp, 'ra.agents.yml'), [
      'agents:',
      '  b: ./agents/b/ra.config.yml',
    ].join('\n'))

    const c = await loadConfig({ cwd: tmp })
    expect(c.agents).toEqual({ a: './agents/a/ra.config.yml' })
    expect(c.agents!['b']).toBeUndefined()
  })
})

describe('--agent flag', () => {
  it('parses --agent from CLI args', () => {
    const result = parseArgs(['bun', 'ra.ts', '--agent', 'coder', 'hello'])
    expect(result.meta.agent).toBe('coder')
    expect(result.meta.prompt).toBe('hello')
  })

  it('agent is undefined when not provided', () => {
    const result = parseArgs(['bun', 'ra.ts', 'hello'])
    expect(result.meta.agent).toBeUndefined()
  })
})

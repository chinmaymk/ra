import { describe, it, expect } from 'bun:test'
import { mergeAgentConfig } from '../../src/orchestrator/merge'
import { defaultConfig } from '../../src/config'
import type { OrchestratorConfig } from '../../src/orchestrator/types'
import type { RaConfig } from '../../src/config/types'
import { join } from 'path'

function makeOrchConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    interface: 'http',
    sessionsDir: './sessions',
    skillDirs: [],
    context: { patterns: [] },
    agents: {},
    configDir: '/project',
    ...overrides,
  }
}

function makeAgentConfig(overrides: Partial<RaConfig> = {}): RaConfig {
  return {
    ...defaultConfig,
    configDir: '/project/agents/coder',
    ...overrides,
  }
}

describe('mergeAgentConfig', () => {
  it('overrides interface with orchestrator value', () => {
    const agent = makeAgentConfig({ interface: 'cli' })
    const orch = makeOrchConfig({ interface: 'http' })
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.interface).toBe('http')
  })

  it('overrides storage.path to sessionsDir/agentName', () => {
    const agent = makeAgentConfig()
    const orch = makeOrchConfig({ sessionsDir: './sessions', configDir: '/project' })
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.storage.path).toBe(join('/project', 'sessions', 'coder'))
  })

  it('overrides memory.path when memory.enabled is true', () => {
    const agent = makeAgentConfig({
      memory: { ...defaultConfig.memory, enabled: true, path: '.ra/memory.db' },
    })
    const orch = makeOrchConfig({ sessionsDir: './sessions', configDir: '/project' })
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.memory.path).toBe(join('/project', 'sessions', 'coder', 'memory.db'))
  })

  it('does not override memory.path when memory is disabled', () => {
    const agent = makeAgentConfig({
      memory: { ...defaultConfig.memory, enabled: false, path: '.ra/memory.db' },
    })
    const orch = makeOrchConfig()
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.memory.path).toBe('.ra/memory.db')
  })

  it('appends orchestrator skillDirs after agent skillDirs', () => {
    const agent = makeAgentConfig({ skillDirs: ['./agent-skills'] })
    const orch = makeOrchConfig({ skillDirs: ['./shared-skills'], configDir: '/project' })
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.skillDirs).toEqual(['./agent-skills', '/project/shared-skills'])
  })

  it('appends orchestrator context patterns after agent patterns', () => {
    const agent = makeAgentConfig({
      context: { ...defaultConfig.context, patterns: ['AGENT.md'] },
    })
    const orch = makeOrchConfig({ context: { patterns: ['CLAUDE.md'] } })
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.context.patterns).toEqual(['AGENT.md', 'CLAUDE.md'])
  })

  it('does not touch provider', () => {
    const agent = makeAgentConfig({ provider: 'openai' })
    const orch = makeOrchConfig()
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.provider).toBe('openai')
  })

  it('does not touch model', () => {
    const agent = makeAgentConfig({ model: 'gpt-4o' })
    const orch = makeOrchConfig()
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.model).toBe('gpt-4o')
  })

  it('does not touch systemPrompt', () => {
    const agent = makeAgentConfig({ systemPrompt: 'You are a coder.' })
    const orch = makeOrchConfig()
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.systemPrompt).toBe('You are a coder.')
  })

  it('does not touch maxIterations', () => {
    const agent = makeAgentConfig({ maxIterations: 10 })
    const orch = makeOrchConfig()
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.maxIterations).toBe(10)
  })

  it('preserves memory settings other than path', () => {
    const agent = makeAgentConfig({
      memory: { enabled: true, path: '.ra/memory.db', maxMemories: 500, ttlDays: 60, injectLimit: 3 },
    })
    const orch = makeOrchConfig({ sessionsDir: './sessions', configDir: '/project' })
    const merged = mergeAgentConfig(agent, orch, 'coder')
    expect(merged.memory.enabled).toBe(true)
    expect(merged.memory.maxMemories).toBe(500)
    expect(merged.memory.ttlDays).toBe(60)
    expect(merged.memory.injectLimit).toBe(3)
  })
})

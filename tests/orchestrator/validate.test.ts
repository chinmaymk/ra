import { describe, it, expect } from 'bun:test'
import { validateOrchestratorRaw, validateNoNameCollisions } from '../../src/orchestrator/validate'
import type { AppContext } from '../../src/bootstrap'
import type { Skill } from '../../src/skills/types'

const filePath = 'ra.agents.yml'

function validRaw(): Record<string, unknown> {
  return {
    interface: 'repl',
    agents: {
      coder: { config: './agents/coder/ra.config.yml' },
    },
  }
}

describe('validateOrchestratorRaw', () => {
  it('passes with valid minimal config', () => {
    expect(() => validateOrchestratorRaw(validRaw(), filePath)).not.toThrow()
  })

  it('throws when agents is missing', () => {
    const raw = { interface: 'repl' }
    expect(() => validateOrchestratorRaw(raw, filePath)).toThrow('Missing or invalid "agents"')
  })

  it('throws when interface is missing', () => {
    const raw = { agents: { coder: { config: './c.yml' } } }
    expect(() => validateOrchestratorRaw(raw, filePath)).toThrow('Missing "interface"')
  })

  it('throws when interface is invalid', () => {
    const raw = { interface: 'websocket', agents: { coder: { config: './c.yml' } } }
    expect(() => validateOrchestratorRaw(raw, filePath)).toThrow('Invalid "interface"')
  })

  it('throws on unknown keys with helpful message', () => {
    const raw = { ...validRaw(), model: 'gpt-4' }
    expect(() => validateOrchestratorRaw(raw, filePath)).toThrow('Unknown key "model"')
  })

  it('throws when agents is empty', () => {
    const raw = { interface: 'repl', agents: {} }
    expect(() => validateOrchestratorRaw(raw, filePath)).toThrow('at least one agent')
  })

  it('throws when agent entry has no config', () => {
    const raw = { interface: 'repl', agents: { coder: {} } }
    expect(() => validateOrchestratorRaw(raw, filePath)).toThrow('must have a "config" string')
  })

  it('throws when more than one default agent', () => {
    const raw = {
      interface: 'repl',
      agents: {
        a: { config: './a.yml', default: true },
        b: { config: './b.yml', default: true },
      },
    }
    expect(() => validateOrchestratorRaw(raw, filePath)).toThrow('At most one agent')
  })

  it('allows one default agent', () => {
    const raw = {
      interface: 'repl',
      agents: {
        a: { config: './a.yml', default: true },
        b: { config: './b.yml' },
      },
    }
    expect(() => validateOrchestratorRaw(raw, filePath)).not.toThrow()
  })

  it('allows optional skillDirs and context', () => {
    const raw = {
      ...validRaw(),
      skillDirs: ['./skills'],
      context: { patterns: ['CLAUDE.md'] },
    }
    expect(() => validateOrchestratorRaw(raw, filePath)).not.toThrow()
  })

  it('throws when skillDirs is not an array', () => {
    const raw = { ...validRaw(), skillDirs: 'not-array' }
    expect(() => validateOrchestratorRaw(raw, filePath)).toThrow('must be an array')
  })
})

describe('validateNoNameCollisions', () => {
  function mockAppContext(skillNames: string[]): AppContext {
    const skillMap = new Map<string, Skill>()
    for (const name of skillNames) {
      skillMap.set(name, {
        metadata: { name, description: '' },
        body: '',
        dir: '',
        scripts: [],
        references: [],
        assets: [],
      })
    }
    return { skillMap } as unknown as AppContext
  }

  it('passes when no collisions', () => {
    const agents = new Map<string, AppContext>([
      ['coder', mockAppContext(['code-review', 'architect'])],
      ['reviewer', mockAppContext(['code-review'])],
    ])
    expect(() => validateNoNameCollisions(['coder', 'reviewer'], agents)).not.toThrow()
  })

  it('throws when agent name matches a skill name', () => {
    const agents = new Map<string, AppContext>([
      ['coder', mockAppContext(['reviewer', 'architect'])],
      ['reviewer', mockAppContext([])],
    ])
    expect(() => validateNoNameCollisions(['coder', 'reviewer'], agents)).toThrow(
      '"reviewer" is both an agent name and a skill name'
    )
  })
})

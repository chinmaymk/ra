import { describe, it, expect } from 'bun:test'
import {
  extractDependencies,
  buildDependencyGraph,
  detectCycle,
  toExecutionGroups,
  resolvePrompt,
  getTransitiveDependents,
} from '@chinmaymk/ra-workflow'

describe('extractDependencies', () => {
  it('extracts step refs from a prompt', () => {
    expect(extractDependencies('Build the API. Design: {{design}}')).toEqual(['design'])
  })

  it('filters out {{input}}', () => {
    expect(extractDependencies('Do this: {{input}} with {{goal}}')).toEqual(['goal'])
  })

  it('returns empty for no refs', () => {
    expect(extractDependencies('Just do the thing')).toEqual([])
  })

  it('deduplicates refs', () => {
    expect(extractDependencies('{{goal}} and also {{goal}}')).toEqual(['goal'])
  })

  it('handles multiple refs', () => {
    expect(extractDependencies('{{design}} {{backend}} {{frontend}}')).toEqual(['design', 'backend', 'frontend'])
  })
})

describe('buildDependencyGraph', () => {
  it('builds graph from steps', () => {
    const graph = buildDependencyGraph([
      { name: 'goal', agent: 'pm', prompt: '{{input}}' },
      { name: 'design', agent: 'arch', prompt: '{{goal}}' },
    ])
    expect(graph.get('goal')?.size).toBe(0)
    expect(graph.get('design')?.has('goal')).toBe(true)
  })

  it('throws on duplicate step names', () => {
    expect(() => buildDependencyGraph([
      { name: 'goal', agent: 'pm', prompt: '{{input}}' },
      { name: 'goal', agent: 'arch', prompt: '{{input}}' },
    ])).toThrow('Duplicate step name: "goal"')
  })

  it('throws on unknown refs', () => {
    expect(() => buildDependencyGraph([
      { name: 'goal', agent: 'pm', prompt: '{{input}}' },
      { name: 'design', agent: 'arch', prompt: '{{nonexistent}}' },
    ])).toThrow('references unknown step "{{nonexistent}}"')
  })
})

describe('detectCycle', () => {
  it('returns null for acyclic graph', () => {
    const graph = new Map([
      ['a', new Set<string>()],
      ['b', new Set(['a'])],
      ['c', new Set(['b'])],
    ])
    expect(detectCycle(graph)).toBeNull()
  })

  it('detects a simple cycle', () => {
    const graph = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['a'])],
    ])
    const cycle = detectCycle(graph)
    expect(cycle).not.toBeNull()
    expect(cycle!.length).toBeGreaterThanOrEqual(2)
  })

  it('detects a longer cycle', () => {
    const graph = new Map([
      ['a', new Set(['c'])],
      ['b', new Set(['a'])],
      ['c', new Set(['b'])],
    ])
    const cycle = detectCycle(graph)
    expect(cycle).not.toBeNull()
  })
})

describe('toExecutionGroups', () => {
  it('groups independent steps together', () => {
    const graph = new Map([
      ['goal', new Set<string>()],
      ['backend', new Set(['goal'])],
      ['frontend', new Set(['goal'])],
      ['qa', new Set(['backend', 'frontend'])],
    ])
    const groups = toExecutionGroups(graph)
    expect(groups).toEqual([
      ['goal'],
      ['backend', 'frontend'],
      ['qa'],
    ])
  })

  it('handles single-step workflow', () => {
    const graph = new Map([['solo', new Set<string>()]])
    expect(toExecutionGroups(graph)).toEqual([['solo']])
  })

  it('handles all-independent steps', () => {
    const graph = new Map([
      ['a', new Set<string>()],
      ['b', new Set<string>()],
      ['c', new Set<string>()],
    ])
    const groups = toExecutionGroups(graph)
    expect(groups).toEqual([['a', 'b', 'c']])
  })

  it('handles linear chain', () => {
    const graph = new Map([
      ['a', new Set<string>()],
      ['b', new Set(['a'])],
      ['c', new Set(['b'])],
    ])
    expect(toExecutionGroups(graph)).toEqual([['a'], ['b'], ['c']])
  })
})

describe('resolvePrompt', () => {
  it('resolves step refs and input', () => {
    const outputs = new Map([['goal', 'build a todo app']])
    const result = resolvePrompt('Design: {{goal}}. Task: {{input}}', outputs, 'make it fast')
    expect(result).toBe('Design: build a todo app. Task: make it fast')
  })

  it('throws for missing output', () => {
    expect(() => resolvePrompt('{{missing}}', new Map(), 'input')).toThrow('Missing output for step "{{missing}}"')
  })
})

describe('getTransitiveDependents', () => {
  it('finds direct and indirect dependents', () => {
    const graph = new Map([
      ['goal', new Set<string>()],
      ['design', new Set(['goal'])],
      ['backend', new Set(['design'])],
      ['frontend', new Set(['design'])],
      ['qa', new Set(['backend', 'frontend'])],
    ])
    const deps = getTransitiveDependents('design', graph)
    expect(deps).toContain('backend')
    expect(deps).toContain('frontend')
    expect(deps).toContain('qa')
    expect(deps).not.toContain('goal')
    expect(deps).not.toContain('design')
  })

  it('returns empty for leaf step', () => {
    const graph = new Map([
      ['a', new Set<string>()],
      ['b', new Set(['a'])],
    ])
    expect(getTransitiveDependents('b', graph).size).toBe(0)
  })
})

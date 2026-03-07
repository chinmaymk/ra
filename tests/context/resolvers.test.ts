import { describe, it, expect } from 'bun:test'
import { resolvePatterns, formatResolvedReferences } from '../../src/context/resolvers'
import type { PatternResolver, ResolvedReference } from '../../src/context/resolvers'

const echoResolver: PatternResolver = {
  name: 'echo',
  pattern: /@(\w+)/g,
  async resolve(ref: string) {
    return `content of ${ref}`
  },
}

const hashResolver: PatternResolver = {
  name: 'hash',
  pattern: /#(\d+)/g,
  async resolve(ref: string) {
    return `issue #${ref}`
  },
}

const failResolver: PatternResolver = {
  name: 'fail',
  pattern: /!(\w+)/g,
  async resolve() {
    throw new Error('resolver error')
  },
}

const nullResolver: PatternResolver = {
  name: 'null',
  pattern: /\?(\w+)/g,
  async resolve() {
    return null
  },
}

describe('resolvePatterns', () => {
  it('returns empty references when no patterns match', async () => {
    const result = await resolvePatterns('hello world', [echoResolver], '/tmp')
    expect(result.references).toEqual([])
    expect(result.text).toBe('hello world')
  })

  it('resolves a single pattern match', async () => {
    const result = await resolvePatterns('check @readme', [echoResolver], '/tmp')
    expect(result.references).toHaveLength(1)
    expect(result.references[0]!.original).toBe('@readme')
    expect(result.references[0]!.ref).toBe('readme')
    expect(result.references[0]!.resolved).toBe('content of readme')
    expect(result.references[0]!.resolver).toBe('echo')
  })

  it('resolves multiple matches from the same resolver', async () => {
    const result = await resolvePatterns('see @foo and @bar', [echoResolver], '/tmp')
    expect(result.references).toHaveLength(2)
    expect(result.references[0]!.ref).toBe('foo')
    expect(result.references[1]!.ref).toBe('bar')
  })

  it('resolves across multiple resolvers', async () => {
    const result = await resolvePatterns('see @readme and #42', [echoResolver, hashResolver], '/tmp')
    expect(result.references).toHaveLength(2)
    expect(result.references[0]!.resolver).toBe('echo')
    expect(result.references[1]!.resolver).toBe('hash')
  })

  it('deduplicates identical matches', async () => {
    const result = await resolvePatterns('@foo then @foo again', [echoResolver], '/tmp')
    expect(result.references).toHaveLength(1)
  })

  it('skips references that resolve to null', async () => {
    const result = await resolvePatterns('try ?missing', [nullResolver], '/tmp')
    expect(result.references).toEqual([])
  })

  it('skips references that throw errors', async () => {
    const result = await resolvePatterns('try !broken', [failResolver], '/tmp')
    expect(result.references).toEqual([])
  })

  it('preserves original text unchanged', async () => {
    const text = 'look at @file please'
    const result = await resolvePatterns(text, [echoResolver], '/tmp')
    expect(result.text).toBe(text)
  })

  it('handles empty resolver list', async () => {
    const result = await resolvePatterns('@foo', [], '/tmp')
    expect(result.references).toEqual([])
  })

  it('handles empty text', async () => {
    const result = await resolvePatterns('', [echoResolver], '/tmp')
    expect(result.references).toEqual([])
  })
})

describe('formatResolvedReferences', () => {
  it('returns empty string for no references', () => {
    expect(formatResolvedReferences([])).toBe('')
  })

  it('wraps each reference in resolved-context XML', () => {
    const refs: ResolvedReference[] = [
      { original: '@foo', ref: 'foo', resolved: 'foo content', resolver: 'echo' },
    ]
    const formatted = formatResolvedReferences(refs)
    expect(formatted).toBe(
      '<resolved-context ref="@foo">\nfoo content\n</resolved-context>'
    )
  })

  it('joins multiple references with double newlines', () => {
    const refs: ResolvedReference[] = [
      { original: '@a', ref: 'a', resolved: 'aaa', resolver: 'echo' },
      { original: '#1', ref: '1', resolved: 'bbb', resolver: 'hash' },
    ]
    const formatted = formatResolvedReferences(refs)
    expect(formatted).toContain('ref="@a"')
    expect(formatted).toContain('ref="#1"')
    expect(formatted).toContain('</resolved-context>\n\n<resolved-context')
  })
})

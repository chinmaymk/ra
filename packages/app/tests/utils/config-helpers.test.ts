import { describe, it, expect } from 'bun:test'
import {
  interpolateString,
  interpolateEnvVars,
  coerceTypes,
  setPath,
  safeParseInt,
  isPlainObject,
} from '../../src/utils/config-helpers'

describe('interpolateString', () => {
  const env = { HOME: '/home/user', TOKEN: 'secret', EMPTY: '' }

  it('replaces ${VAR} with env value', () => {
    expect(interpolateString('${HOME}/config', env)).toBe('/home/user/config')
  })

  it('replaces multiple variables in one string', () => {
    expect(interpolateString('${HOME}:${TOKEN}', env)).toBe('/home/user:secret')
  })

  it('throws for required ${VAR} when unset', () => {
    expect(() => interpolateString('${MISSING}', env)).toThrow(/"MISSING" is required/)
  })

  it('${VAR:-default} uses default when unset', () => {
    expect(interpolateString('${MISSING:-fallback}', env)).toBe('fallback')
  })

  it('${VAR:-default} uses default when empty string', () => {
    expect(interpolateString('${EMPTY:-fallback}', env)).toBe('fallback')
  })

  it('${VAR:-default} uses env value when set and non-empty', () => {
    expect(interpolateString('${HOME:-fallback}', env)).toBe('/home/user')
  })

  it('${VAR-default} uses default only when unset', () => {
    expect(interpolateString('${MISSING-fallback}', env)).toBe('fallback')
  })

  it('${VAR-default} keeps empty string when var is set to ""', () => {
    expect(interpolateString('${EMPTY-fallback}', env)).toBe('')
  })

  it('leaves strings without ${} patterns untouched', () => {
    expect(interpolateString('no vars here', env)).toBe('no vars here')
  })
})

describe('interpolateEnvVars', () => {
  const env = { API_KEY: 'sk-test', PORT: '4000', HOST: 'localhost' }

  it('walks plain objects recursively', () => {
    const input = { providers: { anthropic: { apiKey: '${API_KEY}' } } }
    expect(interpolateEnvVars(input, env)).toEqual({
      providers: { anthropic: { apiKey: 'sk-test' } },
    })
  })

  it('walks arrays', () => {
    const input = { hosts: ['${HOST}:${PORT}', 'static'] }
    expect(interpolateEnvVars(input, env)).toEqual({ hosts: ['localhost:4000', 'static'] })
  })

  it('leaves non-string leaves untouched', () => {
    const input = { port: 3000, enabled: true, name: '${HOST}' }
    expect(interpolateEnvVars(input, env)).toEqual({ port: 3000, enabled: true, name: 'localhost' })
  })

  it('passes strings without ${} through without copying the env regex', () => {
    expect(interpolateEnvVars('literal', env)).toBe('literal')
  })

  it('throws the variable name when a required var is missing', () => {
    expect(() => interpolateEnvVars({ k: '${MISSING}' }, env)).toThrow(/MISSING/)
  })
})

describe('coerceTypes', () => {
  const schema = {
    app: { http: { port: 0 }, logsEnabled: false },
    agent: { maxIterations: 0, model: 'default' },
  }

  it('converts numeric strings to numbers when schema is numeric', () => {
    const input = { app: { http: { port: '4000' } } }
    expect(coerceTypes(input, schema)).toEqual({ app: { http: { port: 4000 } } })
  })

  it('converts "true"/"false" to booleans when schema is boolean', () => {
    expect(coerceTypes({ app: { logsEnabled: 'true' } }, schema)).toEqual({ app: { logsEnabled: true } })
    expect(coerceTypes({ app: { logsEnabled: 'false' } }, schema)).toEqual({ app: { logsEnabled: false } })
  })

  it('leaves strings untouched when schema is a string', () => {
    expect(coerceTypes({ agent: { model: 'gpt-4o' } }, schema)).toEqual({ agent: { model: 'gpt-4o' } })
  })

  it('leaves invalid numeric strings untouched', () => {
    expect(coerceTypes({ app: { http: { port: 'not-a-number' } } }, schema))
      .toEqual({ app: { http: { port: 'not-a-number' } } })
  })

  it('zero is coerced correctly', () => {
    expect(coerceTypes({ agent: { maxIterations: '0' } }, schema))
      .toEqual({ agent: { maxIterations: 0 } })
  })

  it('passes keys not in the schema through untouched', () => {
    expect(coerceTypes({ custom: { whatever: '42' } }, schema))
      .toEqual({ custom: { whatever: '42' } })
  })

  it('handles null and undefined', () => {
    expect(coerceTypes(null, schema)).toBe(null)
    expect(coerceTypes(undefined, schema)).toBe(undefined)
  })
})

describe('isPlainObject', () => {
  it('detects plain objects', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject({ a: 1 })).toBe(true)
  })
  it('rejects arrays, null, primitives', () => {
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('str')).toBe(false)
    expect(isPlainObject(42)).toBe(false)
  })
})

describe('setPath', () => {
  it('creates intermediate objects', () => {
    const obj: Record<string, unknown> = {}
    setPath(obj, ['a', 'b', 'c'], 1)
    expect(obj).toEqual({ a: { b: { c: 1 } } })
  })

  it('does not clobber sibling keys', () => {
    const obj: Record<string, unknown> = { a: { existing: true } }
    setPath(obj, ['a', 'new'], 2)
    expect(obj).toEqual({ a: { existing: true, new: 2 } })
  })
})

describe('safeParseInt', () => {
  it('parses valid integers', () => {
    expect(safeParseInt('42')).toBe(42)
    expect(safeParseInt('0')).toBe(0)
    expect(safeParseInt('-5')).toBe(-5)
  })
  it('returns undefined for garbage', () => {
    expect(safeParseInt('abc')).toBeUndefined()
    expect(safeParseInt('')).toBeUndefined()
  })
})

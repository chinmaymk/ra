import { describe, it, expect } from 'bun:test'
import { interpolateString, interpolateEnvVars } from '../../src/utils/config-helpers'

describe('interpolateString', () => {
  const env = { HOME: '/home/user', TOKEN: 'secret', EMPTY: '' }

  it('replaces ${VAR} with env value', () => {
    expect(interpolateString('${HOME}/config', env)).toBe('/home/user/config')
  })

  it('replaces multiple variables in one string', () => {
    expect(interpolateString('${HOME}:${TOKEN}', env)).toBe('/home/user:secret')
  })

  it('throws for required ${VAR} when unset', () => {
    expect(() => interpolateString('${MISSING}', env)).toThrow('Environment variable "MISSING" is required but not set')
  })

  it('${VAR:-default} uses default when unset', () => {
    expect(interpolateString('${MISSING:-fallback}', env)).toBe('fallback')
  })

  it('${VAR:-default} uses default when empty', () => {
    expect(interpolateString('${EMPTY:-fallback}', env)).toBe('fallback')
  })

  it('${VAR:-default} uses env value when set and non-empty', () => {
    expect(interpolateString('${TOKEN:-fallback}', env)).toBe('secret')
  })

  it('${VAR-default} uses default when unset', () => {
    expect(interpolateString('${MISSING-fallback}', env)).toBe('fallback')
  })

  it('${VAR-default} keeps empty string when set but empty', () => {
    expect(interpolateString('${EMPTY-fallback}', env)).toBe('')
  })

  it('${VAR-default} uses env value when set', () => {
    expect(interpolateString('${TOKEN-fallback}', env)).toBe('secret')
  })

  it('returns string as-is when no ${} patterns', () => {
    expect(interpolateString('no variables here', env)).toBe('no variables here')
  })

  it('handles empty default value ${VAR:-}', () => {
    expect(interpolateString('${MISSING:-}', env)).toBe('')
  })

  it('handles default with special characters', () => {
    expect(interpolateString('${MISSING:-http://localhost:3000}', env)).toBe('http://localhost:3000')
  })
})

describe('interpolateEnvVars', () => {
  const env = { API_KEY: 'sk-123', HOST: 'localhost', PORT: '8080' }

  it('interpolates string values in nested objects', () => {
    const input = {
      app: {
        providers: {
          anthropic: { apiKey: '${API_KEY}' },
        },
      },
    }
    const result = interpolateEnvVars(input, env) as typeof input
    expect(result.app.providers.anthropic.apiKey).toBe('sk-123')
  })

  it('interpolates strings inside arrays', () => {
    const input = { args: ['--host', '${HOST}', '--port', '${PORT}'] }
    const result = interpolateEnvVars(input, env) as typeof input
    expect(result.args).toEqual(['--host', 'localhost', '--port', '8080'])
  })

  it('leaves non-string values unchanged', () => {
    const input = { port: 3000, enabled: true, items: [1, 2, 3] }
    const result = interpolateEnvVars(input, env)
    expect(result).toEqual(input)
  })

  it('leaves null and undefined unchanged', () => {
    expect(interpolateEnvVars(null, env)).toBeNull()
    expect(interpolateEnvVars(undefined, env)).toBeUndefined()
  })

  it('skips strings without ${} patterns (no overhead)', () => {
    const input = { key: 'plain-value', nested: { also: 'plain' } }
    const result = interpolateEnvVars(input, env)
    expect(result).toEqual(input)
  })

  it('throws for missing required variables in nested config', () => {
    const input = { app: { token: '${REQUIRED_VAR}' } }
    expect(() => interpolateEnvVars(input, env)).toThrow('Environment variable "REQUIRED_VAR" is required but not set')
  })
})

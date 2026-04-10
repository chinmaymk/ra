import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  loadSecretsSync,
  saveSecrets,
  setSecret,
  getSecret,
  removeSecret,
  listProfiles,
  getProfileSecrets,
  buildMergedEnv,
  maskSecret,
} from '../../src/secrets/store'

describe('secrets/store', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-secrets-'))
    path = join(dir, 'secrets.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('loadSecretsSync', () => {
    it('returns empty object when file does not exist', () => {
      expect(loadSecretsSync(path)).toEqual({})
    })

    it('returns empty object when file is empty', () => {
      writeFileSync(path, '')
      expect(loadSecretsSync(path)).toEqual({})
    })

    it('returns empty object on invalid JSON', () => {
      writeFileSync(path, '{not json')
      expect(loadSecretsSync(path)).toEqual({})
    })

    it('drops non-string values from profiles', () => {
      writeFileSync(path, JSON.stringify({
        default: { K1: 'v1', K2: 42, K3: true, K4: 'v4' },
      }))
      expect(loadSecretsSync(path)).toEqual({ default: { K1: 'v1', K4: 'v4' } })
    })

    it('drops profiles whose value is not a plain object', () => {
      writeFileSync(path, JSON.stringify({
        default: { K: 'v' },
        bad: 'not an object',
      }))
      expect(loadSecretsSync(path)).toEqual({ default: { K: 'v' } })
    })
  })

  describe('saveSecrets', () => {
    it('writes file with mode 0600', () => {
      saveSecrets({ default: { K: 'v' } }, path)
      const stat = statSync(path)
      expect(stat.mode & 0o777).toBe(0o600)
    })

    it('overwrites existing file', () => {
      saveSecrets({ default: { K: 'v1' } }, path)
      saveSecrets({ default: { K: 'v2' } }, path)
      expect(loadSecretsSync(path)).toEqual({ default: { K: 'v2' } })
    })
  })

  describe('setSecret / getSecret', () => {
    it('writes to default profile when no profile specified', () => {
      setSecret('OPENAI_API_KEY', 'sk-foo', undefined, path)
      expect(getSecret('OPENAI_API_KEY', undefined, path)).toBe('sk-foo')
    })

    it('isolates values between profiles', () => {
      setSecret('OPENAI_API_KEY', 'sk-personal', 'default', path)
      setSecret('OPENAI_API_KEY', 'sk-work',     'work',    path)
      expect(getSecret('OPENAI_API_KEY', 'default', path)).toBe('sk-personal')
      expect(getSecret('OPENAI_API_KEY', 'work',    path)).toBe('sk-work')
    })

    it('returns undefined for missing secrets', () => {
      expect(getSecret('NOPE', 'default', path)).toBeUndefined()
    })

    it('preserves existing keys when adding new ones', () => {
      setSecret('A', 'a', 'default', path)
      setSecret('B', 'b', 'default', path)
      expect(getProfileSecrets('default', path)).toEqual({ A: 'a', B: 'b' })
    })
  })

  describe('removeSecret', () => {
    it('returns false when secret does not exist', () => {
      expect(removeSecret('NOPE', 'default', path)).toBe(false)
    })

    it('removes the secret and returns true', () => {
      setSecret('K', 'v', 'default', path)
      expect(removeSecret('K', 'default', path)).toBe(true)
      expect(getSecret('K', 'default', path)).toBeUndefined()
    })

    it('drops the entire profile when its last key is removed', () => {
      setSecret('K', 'v', 'work', path)
      removeSecret('K', 'work', path)
      expect(listProfiles(path)).not.toContain('work')
    })

    it('keeps other profiles intact when one is dropped', () => {
      setSecret('K', 'v', 'default', path)
      setSecret('K', 'v', 'work',    path)
      removeSecret('K', 'work', path)
      expect(listProfiles(path)).toEqual(['default'])
    })
  })

  describe('listProfiles', () => {
    it('returns empty array for missing file', () => {
      expect(listProfiles(path)).toEqual([])
    })

    it('returns sorted profile names', () => {
      setSecret('K', 'v', 'work', path)
      setSecret('K', 'v', 'acme', path)
      setSecret('K', 'v', 'default', path)
      expect(listProfiles(path)).toEqual(['acme', 'default', 'work'])
    })
  })

  describe('buildMergedEnv', () => {
    it('returns process.env when secrets file is empty', () => {
      const env = buildMergedEnv('default', { FOO: 'bar' }, path)
      expect(env).toEqual({ FOO: 'bar' })
    })

    it('fills missing env entries from secrets', () => {
      setSecret('OPENAI_API_KEY', 'sk-stored', 'default', path)
      const env = buildMergedEnv('default', { OTHER: 'x' }, path)
      expect(env.OPENAI_API_KEY).toBe('sk-stored')
      expect(env.OTHER).toBe('x')
    })

    it('real env always wins over secrets', () => {
      setSecret('OPENAI_API_KEY', 'sk-stored', 'default', path)
      const env = buildMergedEnv('default', { OPENAI_API_KEY: 'sk-real' }, path)
      expect(env.OPENAI_API_KEY).toBe('sk-real')
    })

    it('selects the right profile', () => {
      setSecret('K', 'default-val', 'default', path)
      setSecret('K', 'work-val',    'work',    path)
      expect(buildMergedEnv('work', {}, path).K).toBe('work-val')
      expect(buildMergedEnv('default', {}, path).K).toBe('default-val')
    })

    it('returns only env when profile does not exist', () => {
      const env = buildMergedEnv('nonexistent', { X: 'y' }, path)
      expect(env).toEqual({ X: 'y' })
    })
  })

  describe('maskSecret', () => {
    it('hides short values entirely', () => {
      expect(maskSecret('short')).toBe('••••••••')
      expect(maskSecret('12345678')).toBe('••••••••')
    })

    it('keeps prefix and suffix for longer values', () => {
      expect(maskSecret('sk-1234567890abcdef')).toBe('sk-…cdef')
    })
  })

  describe('file isolation', () => {
    it('writes to the path argument, not the default', () => {
      setSecret('K', 'v', 'default', path)
      expect(existsSync(path)).toBe(true)
    })
  })
})

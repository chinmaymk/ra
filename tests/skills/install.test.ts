import { describe, it, expect } from 'bun:test'
import { parseGithubUrl } from '../../src/skills/install'

describe('parseGithubUrl', () => {
  it('parses github.com/owner/repo', () => {
    const result = parseGithubUrl('github.com/anthropics/skills')
    expect(result).toEqual({ owner: 'anthropics', repo: 'skills', ref: undefined })
  })

  it('parses https://github.com/owner/repo', () => {
    const result = parseGithubUrl('https://github.com/anthropics/skills')
    expect(result).toEqual({ owner: 'anthropics', repo: 'skills', ref: undefined })
  })

  it('parses owner/repo shorthand', () => {
    const result = parseGithubUrl('anthropics/skills')
    expect(result).toEqual({ owner: 'anthropics', repo: 'skills', ref: undefined })
  })

  it('parses with ref/branch', () => {
    const result = parseGithubUrl('anthropics/skills@v2')
    expect(result).toEqual({ owner: 'anthropics', repo: 'skills', ref: 'v2' })
  })

  it('returns null for invalid URLs', () => {
    expect(parseGithubUrl('not-valid')).toBeNull()
    expect(parseGithubUrl('')).toBeNull()
  })
})

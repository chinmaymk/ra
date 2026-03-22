import { describe, it, expect } from 'bun:test'
import { parseSource, splitNpmVersion } from '../../src/registry/helpers'

describe('parseSource', () => {
  it('npm: prefix', () => {
    expect(parseSource('npm:ra-skill-lint')).toEqual({ registry: 'npm', identifier: 'ra-skill-lint' })
  })

  it('npm: prefix with version', () => {
    expect(parseSource('npm:ra-skill-lint@1.2.3')).toEqual({ registry: 'npm', identifier: 'ra-skill-lint', version: '1.2.3' })
  })

  it('npm: scoped package', () => {
    expect(parseSource('npm:@scope/recipe')).toEqual({ registry: 'npm', identifier: '@scope/recipe' })
  })

  it('npm: scoped package with version', () => {
    expect(parseSource('npm:@scope/recipe@2.0')).toEqual({ registry: 'npm', identifier: '@scope/recipe', version: '2.0' })
  })

  it('github: prefix', () => {
    expect(parseSource('github:user/repo')).toEqual({ registry: 'github', identifier: 'user/repo' })
  })

  it('https url', () => {
    expect(parseSource('https://example.com/skill.tgz')).toEqual({ registry: 'url', identifier: 'https://example.com/skill.tgz' })
  })

  it('http url', () => {
    expect(parseSource('http://example.com/skill.tgz')).toEqual({ registry: 'url', identifier: 'http://example.com/skill.tgz' })
  })

  it('bare name defaults to github', () => {
    expect(parseSource('user/repo')).toEqual({ registry: 'github', identifier: 'user/repo' })
  })

  it('bare name without slash defaults to github', () => {
    expect(parseSource('my-recipe')).toEqual({ registry: 'github', identifier: 'my-recipe' })
  })
})

describe('splitNpmVersion', () => {
  it('plain package name', () => {
    expect(splitNpmVersion('foo')).toEqual({ registry: 'npm', identifier: 'foo' })
  })

  it('package with version', () => {
    expect(splitNpmVersion('foo@1.0.0')).toEqual({ registry: 'npm', identifier: 'foo', version: '1.0.0' })
  })

  it('scoped package', () => {
    expect(splitNpmVersion('@scope/foo')).toEqual({ registry: 'npm', identifier: '@scope/foo' })
  })

  it('scoped package with version', () => {
    expect(splitNpmVersion('@scope/foo@2.0')).toEqual({ registry: 'npm', identifier: '@scope/foo', version: '2.0' })
  })
})

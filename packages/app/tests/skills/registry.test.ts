import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  parseSkillSource, parseRecipeSource,
  defaultSkillInstallDir, defaultRecipeInstallDir,
  listInstalledSkills, listInstalledRecipes,
  removeSkill, removeRecipe,
  resolveRecipeConfigPath,
} from '../../src/skills/registry'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from '../tmpdir'

const TEST_DIR = tmpdir('ra-test-registry')

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('parseSkillSource', () => {
  it('parses npm: prefix', () => {
    const result = parseSkillSource('npm:ra-skill-lint')
    expect(result).toEqual({ registry: 'npm', identifier: 'ra-skill-lint' })
  })

  it('parses npm: prefix with version', () => {
    const result = parseSkillSource('npm:ra-skill-lint@1.2.3')
    expect(result).toEqual({ registry: 'npm', identifier: 'ra-skill-lint', version: '1.2.3' })
  })

  it('parses github: prefix', () => {
    const result = parseSkillSource('github:user/repo')
    expect(result).toEqual({ registry: 'github', identifier: 'user/repo' })
  })

  it('parses https:// URL', () => {
    const result = parseSkillSource('https://example.com/skill.tgz')
    expect(result).toEqual({ registry: 'url', identifier: 'https://example.com/skill.tgz' })
  })

  it('parses bare owner/repo as github', () => {
    const result = parseSkillSource('user/repo')
    expect(result).toEqual({ registry: 'github', identifier: 'user/repo' })
  })

  it('defaults bare name to npm', () => {
    const result = parseSkillSource('code-review')
    expect(result).toEqual({ registry: 'npm', identifier: 'code-review' })
  })

  it('defaults bare name with version to npm', () => {
    const result = parseSkillSource('code-review@2.0.0')
    expect(result).toEqual({ registry: 'npm', identifier: 'code-review', version: '2.0.0' })
  })
})

describe('parseRecipeSource', () => {
  it('parses github: prefix', () => {
    const result = parseRecipeSource('github:user/repo')
    expect(result).toEqual({ registry: 'github', identifier: 'user/repo' })
  })

  it('parses bare owner/repo as github', () => {
    const result = parseRecipeSource('user/repo')
    expect(result).toEqual({ registry: 'github', identifier: 'user/repo' })
  })

  it('parses https:// URL', () => {
    const result = parseRecipeSource('https://example.com/recipe.tgz')
    expect(result).toEqual({ registry: 'url', identifier: 'https://example.com/recipe.tgz' })
  })

  it('throws on npm: prefix', () => {
    expect(() => parseRecipeSource('npm:some-pkg')).toThrow('Unsupported recipe source')
  })

  it('throws on bare name', () => {
    expect(() => parseRecipeSource('some-recipe')).toThrow('Unsupported recipe source')
  })
})

describe('defaultSkillInstallDir', () => {
  it('returns a path under dataDir/skills', () => {
    const dir = defaultSkillInstallDir('/tmp/project/.ra')
    expect(dir).toBe('/tmp/project/.ra/skills')
  })
})

describe('defaultRecipeInstallDir', () => {
  it('returns a global path under ~/.ra/recipes', () => {
    const dir = defaultRecipeInstallDir()
    expect(dir).toContain('.ra')
    expect(dir).toContain('recipes')
  })
})

describe('listInstalledSkills', () => {
  it('returns empty list when no skills', async () => {
    const skills = await listInstalledSkills(TEST_DIR)
    expect(skills).toEqual([])
  })

  it('lists skills with SKILL.md', async () => {
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    const skills = await listInstalledSkills(TEST_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('review')
  })

  it('includes source info when available', async () => {
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    writeFileSync(`${TEST_DIR}/review/.source.json`, JSON.stringify({
      registry: 'npm',
      package: 'ra-skill-review',
      version: '1.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
    }))
    const skills = await listInstalledSkills(TEST_DIR)
    expect(skills[0]!.source).toBeDefined()
    expect(skills[0]!.source!.registry).toBe('npm')
    expect(skills[0]!.source!.package).toBe('ra-skill-review')
  })
})

describe('removeSkill', () => {
  it('removes a skill directory', async () => {
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    await removeSkill('review', TEST_DIR)
    expect(existsSync(`${TEST_DIR}/review`)).toBe(false)
  })

  it('throws for nonexistent skill', async () => {
    await expect(removeSkill('nonexistent', TEST_DIR)).rejects.toThrow('Skill not found')
  })
})

describe('listInstalledRecipes', () => {
  it('returns empty list when no recipes', async () => {
    const recipes = await listInstalledRecipes(TEST_DIR)
    expect(recipes).toEqual([])
  })

  it('lists recipes with ra.config.yaml', async () => {
    mkdirSync(`${TEST_DIR}/coding-agent`, { recursive: true })
    writeFileSync(`${TEST_DIR}/coding-agent/ra.config.yaml`, 'provider: anthropic\nmodel: claude-sonnet-4-6')
    const recipes = await listInstalledRecipes(TEST_DIR)
    expect(recipes).toHaveLength(1)
    expect(recipes[0]!.name).toBe('coding-agent')
  })

  it('lists recipes with ra.config.yml', async () => {
    mkdirSync(`${TEST_DIR}/my-agent`, { recursive: true })
    writeFileSync(`${TEST_DIR}/my-agent/ra.config.yml`, 'provider: openai')
    const recipes = await listInstalledRecipes(TEST_DIR)
    expect(recipes).toHaveLength(1)
    expect(recipes[0]!.name).toBe('my-agent')
  })

  it('includes source info when available', async () => {
    mkdirSync(`${TEST_DIR}/coding-agent`, { recursive: true })
    writeFileSync(`${TEST_DIR}/coding-agent/ra.config.yaml`, 'provider: anthropic')
    writeFileSync(`${TEST_DIR}/coding-agent/.source.json`, JSON.stringify({
      registry: 'github',
      repo: 'chinmaymk/ra',
      installedAt: '2026-01-01T00:00:00.000Z',
    }))
    const recipes = await listInstalledRecipes(TEST_DIR)
    expect(recipes[0]!.source).toBeDefined()
    expect(recipes[0]!.source!.registry).toBe('github')
    expect(recipes[0]!.source!.repo).toBe('chinmaymk/ra')
  })
})

describe('removeRecipe', () => {
  it('removes a recipe directory', async () => {
    mkdirSync(`${TEST_DIR}/coding-agent`, { recursive: true })
    writeFileSync(`${TEST_DIR}/coding-agent/ra.config.yaml`, 'provider: anthropic')
    await removeRecipe('coding-agent', TEST_DIR)
    expect(existsSync(`${TEST_DIR}/coding-agent`)).toBe(false)
  })

  it('throws for nonexistent recipe', async () => {
    await expect(removeRecipe('nonexistent', TEST_DIR)).rejects.toThrow('Recipe not found')
  })
})

describe('resolveRecipeConfigPath', () => {
  it('resolves ra.config.yaml', async () => {
    mkdirSync(`${TEST_DIR}/coding-agent`, { recursive: true })
    writeFileSync(`${TEST_DIR}/coding-agent/ra.config.yaml`, 'provider: anthropic')
    const path = await resolveRecipeConfigPath('coding-agent', TEST_DIR)
    expect(path).toContain('coding-agent')
    expect(path).toContain('ra.config.yaml')
  })

  it('resolves ra.config.yml', async () => {
    mkdirSync(`${TEST_DIR}/my-agent`, { recursive: true })
    writeFileSync(`${TEST_DIR}/my-agent/ra.config.yml`, 'provider: openai')
    const path = await resolveRecipeConfigPath('my-agent', TEST_DIR)
    expect(path).toContain('ra.config.yml')
  })

  it('returns undefined for nonexistent recipe', async () => {
    const path = await resolveRecipeConfigPath('nonexistent', TEST_DIR)
    expect(path).toBeUndefined()
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseRecipeSource, resolveRecipePath, installRecipe, removeRecipe, listInstalledRecipes } from '../../src/recipes/registry'

describe('parseRecipeSource', () => {
  it('bare name with slash defaults to github', () => {
    expect(parseRecipeSource('user/repo')).toEqual({ registry: 'github', identifier: 'user/repo' })
  })

  it('bare name without slash defaults to npm', () => {
    expect(parseRecipeSource('my-recipe')).toEqual({ registry: 'npm', identifier: 'my-recipe' })
  })

  it('github: prefix', () => {
    expect(parseRecipeSource('github:user/repo')).toEqual({ registry: 'github', identifier: 'user/repo' })
  })

  it('npm: prefix', () => {
    expect(parseRecipeSource('npm:my-recipe')).toEqual({ registry: 'npm', identifier: 'my-recipe' })
  })

  it('npm: prefix with version', () => {
    expect(parseRecipeSource('npm:my-recipe@1.0.0')).toEqual({ registry: 'npm', identifier: 'my-recipe', version: '1.0.0' })
  })

  it('npm: scoped package', () => {
    expect(parseRecipeSource('npm:@scope/recipe')).toEqual({ registry: 'npm', identifier: '@scope/recipe' })
  })

  it('npm: scoped package with version', () => {
    expect(parseRecipeSource('npm:@scope/recipe@2.0')).toEqual({ registry: 'npm', identifier: '@scope/recipe', version: '2.0' })
  })

  it('https url', () => {
    expect(parseRecipeSource('https://example.com/recipe.tgz')).toEqual({ registry: 'url', identifier: 'https://example.com/recipe.tgz' })
  })

  it('http url', () => {
    expect(parseRecipeSource('http://example.com/recipe.tgz')).toEqual({ registry: 'url', identifier: 'http://example.com/recipe.tgz' })
  })
})

describe('resolveRecipePath', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-recipe-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns null for non-existent recipe', async () => {
    expect(await resolveRecipePath('nonexistent/recipe', tmp)).toBeNull()
  })

  it('resolves yaml config file', async () => {
    const recipeDir = join(tmp, 'user', 'my-recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), 'agent:\n  model: test\n')

    const path = await resolveRecipePath('user/my-recipe', tmp)
    expect(path).toBe(join(recipeDir, 'ra.config.yaml'))
  })

  it('resolves json config file', async () => {
    const recipeDir = join(tmp, 'user', 'my-recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.json'), '{}')

    const path = await resolveRecipePath('user/my-recipe', tmp)
    expect(path).toBe(join(recipeDir, 'ra.config.json'))
  })

  it('returns null when directory exists but has no config file', async () => {
    const recipeDir = join(tmp, 'user', 'my-recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'README.md'), 'hello')

    expect(await resolveRecipePath('user/my-recipe', tmp)).toBeNull()
  })
})

describe('listInstalledRecipes', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-recipe-list-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns empty array when no recipes installed', async () => {
    expect(await listInstalledRecipes(tmp)).toEqual([])
  })

  it('lists installed recipes', async () => {
    const recipeDir = join(tmp, 'user', 'recipe-a')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), 'agent:\n  model: test\n')
    writeFileSync(join(recipeDir, '.source.json'), JSON.stringify({
      registry: 'github',
      repo: 'user/recipe-a',
      installedAt: '2026-01-01T00:00:00.000Z',
    }))

    const recipes = await listInstalledRecipes(tmp)
    expect(recipes).toHaveLength(1)
    expect(recipes[0]!.name).toBe('user/recipe-a')
    expect(recipes[0]!.source?.registry).toBe('github')
  })

  it('lists multiple recipes', async () => {
    for (const name of ['user/a', 'user/b']) {
      const dir = join(tmp, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'ra.config.yaml'), 'agent:\n  model: test\n')
    }

    const recipes = await listInstalledRecipes(tmp)
    expect(recipes).toHaveLength(2)
    const names = recipes.map(r => r.name).sort()
    expect(names).toEqual(['user/a', 'user/b'])
  })
})

describe('removeRecipe', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-recipe-rm-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('removes an installed recipe', async () => {
    const recipeDir = join(tmp, 'user', 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), 'agent:\n  model: test\n')

    await removeRecipe('user/recipe', tmp)
    expect(await resolveRecipePath('user/recipe', tmp)).toBeNull()
  })

  it('throws for non-existent recipe', async () => {
    expect(removeRecipe('nonexistent/recipe', tmp)).rejects.toThrow('Recipe not found')
  })
})

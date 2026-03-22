import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../../src/config'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from '../tmpdir'

const TMP = tmpdir('ra-test-recipe-merge')

beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

/** Write a recipe config file and return its path. */
function writeRecipe(fields: string[]): string {
  const dir = join(TMP, 'recipe')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'ra.config.yaml')
  writeFileSync(path, fields.join('\n'))
  return path
}

// ── recipe in loadConfig layer chain ────────────────────────────────

describe('loadConfig with recipePath', () => {
  it('recipe provides base values that override defaults', async () => {
    const recipePath = writeRecipe([
      'agent:',
      '  provider: openai',
      '  model: gpt-4o',
      '  maxIterations: 100',
      '  systemPrompt: "You are a coding agent."',
    ])

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.agent.provider).toBe('openai')
    expect(config.agent.model).toBe('gpt-4o')
    expect(config.agent.maxIterations).toBe(100)
    expect(config.agent.systemPrompt).toBe('You are a coding agent.')
  })

  it('user config file overrides recipe values', async () => {
    const recipePath = writeRecipe([
      'agent:',
      '  provider: anthropic',
      '  model: claude-sonnet-4-6',
      '  maxIterations: 100',
      '  systemPrompt: "Recipe prompt"',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), 'agent:\n  model: claude-opus-4-6\n')

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.agent.model).toBe('claude-opus-4-6')       // user wins
    expect(config.agent.maxIterations).toBe(100)              // recipe preserved
    expect(config.agent.systemPrompt).toBe('Recipe prompt')   // recipe preserved
  })

  it('user config file overrides recipe model', async () => {
    const recipePath = writeRecipe([
      'agent:',
      '  provider: anthropic',
      '  model: claude-sonnet-4-6',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), 'agent:\n  model: custom-model\n')

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.agent.model).toBe('custom-model')
  })

  it('CLI args override recipe values', async () => {
    const recipePath = writeRecipe([
      'agent:',
      '  provider: anthropic',
      '  maxIterations: 100',
    ])

    const config = await loadConfig({
      cwd: TMP, env: {}, cliArgs: { agent: { maxIterations: 10 } } as any, recipePath,
    })

    expect(config.agent.maxIterations).toBe(10)
  })

  it('deep-merges nested objects (recipe providers + user providers)', async () => {
    const recipePath = writeRecipe([
      'agent:',
      '  provider: anthropic',
      'app:',
      '  providers:',
      '    anthropic:',
      '      baseURL: https://recipe-proxy.example.com',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), [
      'app:',
      '  providers:',
      '    anthropic:',
      '      apiKey: sk-user-key',
    ].join('\n'))

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.app.providers.anthropic.apiKey).toBe('sk-user-key')
    expect(config.app.providers.anthropic.baseURL).toBe('https://recipe-proxy.example.com')
  })

  it('user skillDirs replace recipe skillDirs (array replacement)', async () => {
    const recipePath = writeRecipe([
      'app:',
      '  skillDirs:',
      '    - /recipe/skills',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), 'app:\n  skillDirs:\n    - /user/skills\n')

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.app.skillDirs).toEqual(['/user/skills'])
  })

  it('full precedence: defaults < recipe < file < CLI', async () => {
    const recipePath = writeRecipe([
      'agent:',
      '  provider: openai',
      '  model: gpt-4o',
      '  maxIterations: 200',
      '  systemPrompt: "Recipe prompt"',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), [
      'agent:',
      '  model: claude-sonnet-4-6',
      '  maxIterations: 100',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: {},
      cliArgs: { agent: { provider: 'google' } } as any,
      recipePath,
    })

    expect(config.agent.provider).toBe('google')            // CLI wins
    expect(config.agent.maxIterations).toBe(100)             // file wins over recipe
    expect(config.agent.model).toBe('claude-sonnet-4-6')     // file wins over recipe
    expect(config.agent.systemPrompt).toBe('Recipe prompt')  // recipe wins over default
  })
})

// ── recipeName + resolveRecipePath (name-based resolution) ──────────

describe('loadConfig with recipeName + resolveRecipePath', () => {
  it('resolves recipe by name via callback', async () => {
    const recipePath = writeRecipe(['agent:\n  maxIterations: 200'])
    const resolver = async (name: string) => name === 'my-recipe' ? recipePath : undefined

    const config = await loadConfig({
      cwd: TMP, env: {}, recipeName: 'my-recipe', resolveRecipePath: resolver,
    })

    expect(config.agent.maxIterations).toBe(200)
  })

  it('picks up recipe name from config file when recipeName is not provided', async () => {
    const recipePath = writeRecipe(['agent:\n  maxIterations: 200'])
    writeFileSync(join(TMP, 'ra.config.yaml'), 'recipe: my-recipe\n')
    const resolver = async (name: string) => name === 'my-recipe' ? recipePath : undefined

    const config = await loadConfig({
      cwd: TMP, env: {}, resolveRecipePath: resolver,
    })

    expect(config.agent.maxIterations).toBe(200)
  })

  it('recipeName from option takes precedence over config file recipe field', async () => {
    const recipeA = writeRecipe(['agent:\n  maxIterations: 100'])
    const recipeBDir = join(TMP, 'recipe-b')
    mkdirSync(recipeBDir, { recursive: true })
    const recipeBPath = join(recipeBDir, 'ra.config.yaml')
    writeFileSync(recipeBPath, 'agent:\n  maxIterations: 200')

    writeFileSync(join(TMP, 'ra.config.yaml'), 'recipe: recipe-a\n')
    const resolver = async (name: string) => {
      if (name === 'recipe-a') return recipeA
      if (name === 'recipe-b') return recipeBPath
      return undefined
    }

    const config = await loadConfig({
      cwd: TMP, env: {}, recipeName: 'recipe-b', resolveRecipePath: resolver,
    })

    expect(config.agent.maxIterations).toBe(200)
  })

  it('throws when recipe name cannot be resolved', async () => {
    const resolver = async () => undefined

    expect(loadConfig({
      cwd: TMP, env: {}, recipeName: 'nonexistent', resolveRecipePath: resolver,
    })).rejects.toThrow('Recipe not found: nonexistent')
  })

  it('skips resolution when no resolveRecipePath callback is provided', async () => {
    writeFileSync(join(TMP, 'ra.config.yaml'), 'recipe: some-recipe\n')

    // No resolver provided — recipe field is ignored, no error
    const config = await loadConfig({ cwd: TMP, env: {} })
    expect(config.recipe).toBe('some-recipe')
    expect(config.agent.maxIterations).toBe(50) // default, not recipe
  })
})

// ── config.recipe field ─────────────────────────────────────────────

describe('config file recipe field', () => {
  it('recipe field is preserved in loaded config', async () => {
    writeFileSync(join(TMP, 'ra.config.yaml'), 'recipe: coding-agent\n')
    const config = await loadConfig({ cwd: TMP, env: {} })
    expect(config.recipe).toBe('coding-agent')
  })

  it('recipe field defaults to undefined', async () => {
    const config = await loadConfig({ cwd: TMP, env: {} })
    expect(config.recipe).toBeUndefined()
  })
})

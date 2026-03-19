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
      'provider: openai',
      'model: gpt-4o',
      'maxIterations: 100',
      'systemPrompt: "You are a coding agent."',
    ])

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
    expect(config.maxIterations).toBe(100)
    expect(config.systemPrompt).toBe('You are a coding agent.')
  })

  it('user config file overrides recipe values', async () => {
    const recipePath = writeRecipe([
      'provider: anthropic',
      'model: claude-sonnet-4-6',
      'maxIterations: 100',
      'systemPrompt: "Recipe prompt"',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), 'model: claude-opus-4-6\n')

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.model).toBe('claude-opus-4-6')       // user wins
    expect(config.maxIterations).toBe(100)              // recipe preserved
    expect(config.systemPrompt).toBe('Recipe prompt')   // recipe preserved
  })

  it('env vars override recipe values', async () => {
    const recipePath = writeRecipe([
      'provider: anthropic',
      'model: claude-sonnet-4-6',
    ])

    const config = await loadConfig({ cwd: TMP, env: { RA_MODEL: 'custom-model' }, recipePath })

    expect(config.model).toBe('custom-model')
  })

  it('CLI args override recipe values', async () => {
    const recipePath = writeRecipe([
      'provider: anthropic',
      'maxIterations: 100',
    ])

    const config = await loadConfig({
      cwd: TMP, env: {}, cliArgs: { maxIterations: 10 }, recipePath,
    })

    expect(config.maxIterations).toBe(10)
  })

  it('deep-merges nested objects (recipe providers + user providers)', async () => {
    const recipePath = writeRecipe([
      'provider: anthropic',
      'providers:',
      '  anthropic:',
      '    baseURL: https://recipe-proxy.example.com',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), [
      'providers:',
      '  anthropic:',
      '    apiKey: sk-user-key',
    ].join('\n'))

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.providers.anthropic.apiKey).toBe('sk-user-key')
    expect(config.providers.anthropic.baseURL).toBe('https://recipe-proxy.example.com')
  })

  it('user skillDirs replace recipe skillDirs (array replacement)', async () => {
    const recipePath = writeRecipe([
      'skillDirs:',
      '  - /recipe/skills',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), 'skillDirs:\n  - /user/skills\n')

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.skillDirs).toEqual(['/user/skills'])
  })

  it('recipe skills apply when user does not override', async () => {
    const recipePath = writeRecipe([
      'skills:',
      '  - code-review',
      '  - architect',
    ])

    const config = await loadConfig({ cwd: TMP, env: {}, recipePath })

    expect(config.skills).toEqual(['code-review', 'architect'])
  })

  it('full precedence: defaults < recipe < file < env < CLI', async () => {
    const recipePath = writeRecipe([
      'provider: openai',
      'model: gpt-4o',
      'maxIterations: 200',
      'systemPrompt: "Recipe prompt"',
    ])
    writeFileSync(join(TMP, 'ra.config.yaml'), [
      'model: claude-sonnet-4-6',
      'maxIterations: 100',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: { RA_MAX_ITERATIONS: '50' },
      cliArgs: { provider: 'google' as const },
      recipePath,
    })

    expect(config.provider).toBe('google')            // CLI wins
    expect(config.maxIterations).toBe(50)              // env wins
    expect(config.model).toBe('claude-sonnet-4-6')     // file wins over recipe
    expect(config.systemPrompt).toBe('Recipe prompt')  // recipe wins over default
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

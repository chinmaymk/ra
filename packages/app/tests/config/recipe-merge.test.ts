import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig, findConfigFilePath } from '../../src/config'
import { defaultSkillInstallDir } from '../../src/skills/registry'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from '../tmpdir'

const TMP = tmpdir('ra-test-recipe-merge')

beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

// ── findConfigFilePath ──────────────────────────────────────────────

describe('findConfigFilePath', () => {
  it('returns undefined when no config file exists', async () => {
    expect(await findConfigFilePath(TMP)).toBeUndefined()
  })

  it('finds ra.config.yaml in cwd', async () => {
    writeFileSync(join(TMP, 'ra.config.yaml'), 'provider: anthropic')
    const path = await findConfigFilePath(TMP)
    expect(path).toBe(join(TMP, 'ra.config.yaml'))
  })

  it('finds ra.config.json in cwd', async () => {
    writeFileSync(join(TMP, 'ra.config.json'), '{}')
    const path = await findConfigFilePath(TMP)
    expect(path).toBe(join(TMP, 'ra.config.json'))
  })

  it('finds ra.config.toml in cwd', async () => {
    writeFileSync(join(TMP, 'ra.config.toml'), 'provider = "openai"')
    const path = await findConfigFilePath(TMP)
    expect(path).toBe(join(TMP, 'ra.config.toml'))
  })

  it('walks up to find config in parent directory', async () => {
    writeFileSync(join(TMP, 'ra.config.yaml'), 'provider: google')
    const child = join(TMP, 'a', 'b', 'c')
    mkdirSync(child, { recursive: true })
    const path = await findConfigFilePath(child)
    expect(path).toBe(join(TMP, 'ra.config.yaml'))
  })

  it('prefers config in cwd over parent', async () => {
    writeFileSync(join(TMP, 'ra.config.yaml'), 'provider: google')
    const child = join(TMP, 'sub')
    mkdirSync(child, { recursive: true })
    writeFileSync(join(child, 'ra.config.json'), '{}')
    const path = await findConfigFilePath(child)
    expect(path).toBe(join(child, 'ra.config.json'))
  })
})

// ── recipe in loadConfig layer chain ────────────────────────────────

describe('loadConfig with recipePath', () => {
  it('recipe provides base values that show through defaults', async () => {
    const recipeDir = join(TMP, 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'provider: openai',
      'model: gpt-4o',
      'maxIterations: 100',
      'systemPrompt: "You are a coding agent."',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: {},
      recipePath: join(recipeDir, 'ra.config.yaml'),
    })

    // Recipe values override defaults
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
    expect(config.maxIterations).toBe(100)
    expect(config.systemPrompt).toBe('You are a coding agent.')
  })

  it('user config file overrides recipe values', async () => {
    const recipeDir = join(TMP, 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'provider: anthropic',
      'model: claude-sonnet-4-6',
      'maxIterations: 100',
      'systemPrompt: "Recipe prompt"',
    ].join('\n'))

    // User config overrides model but not maxIterations
    writeFileSync(join(TMP, 'ra.config.yaml'), [
      'model: claude-opus-4-6',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: {},
      recipePath: join(recipeDir, 'ra.config.yaml'),
    })

    expect(config.model).toBe('claude-opus-4-6')       // user wins
    expect(config.maxIterations).toBe(100)              // recipe value preserved
    expect(config.systemPrompt).toBe('Recipe prompt')   // recipe value preserved
  })

  it('env vars override recipe values', async () => {
    const recipeDir = join(TMP, 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'provider: anthropic',
      'model: claude-sonnet-4-6',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: { RA_MODEL: 'custom-model' },
      recipePath: join(recipeDir, 'ra.config.yaml'),
    })

    expect(config.model).toBe('custom-model')
  })

  it('CLI args override recipe values', async () => {
    const recipeDir = join(TMP, 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'provider: anthropic',
      'maxIterations: 100',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: {},
      cliArgs: { maxIterations: 10 },
      recipePath: join(recipeDir, 'ra.config.yaml'),
    })

    expect(config.maxIterations).toBe(10)
  })

  it('deep-merges nested objects (recipe providers + user providers)', async () => {
    const recipeDir = join(TMP, 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'provider: anthropic',
      'providers:',
      '  anthropic:',
      '    baseURL: https://recipe-proxy.example.com',
    ].join('\n'))

    writeFileSync(join(TMP, 'ra.config.yaml'), [
      'providers:',
      '  anthropic:',
      '    apiKey: sk-user-key',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: {},
      recipePath: join(recipeDir, 'ra.config.yaml'),
    })

    expect(config.providers.anthropic.apiKey).toBe('sk-user-key')
    expect(config.providers.anthropic.baseURL).toBe('https://recipe-proxy.example.com')
  })

  it('user skillDirs replace recipe skillDirs (array replacement)', async () => {
    const recipeDir = join(TMP, 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'skillDirs:',
      '  - /recipe/skills',
    ].join('\n'))

    writeFileSync(join(TMP, 'ra.config.yaml'), [
      'skillDirs:',
      '  - /user/skills',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: {},
      recipePath: join(recipeDir, 'ra.config.yaml'),
    })

    expect(config.skillDirs).toEqual(['/user/skills'])
  })

  it('recipe skills apply when user does not override', async () => {
    const recipeDir = join(TMP, 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'skills:',
      '  - code-review',
      '  - architect',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: {},
      recipePath: join(recipeDir, 'ra.config.yaml'),
    })

    expect(config.skills).toEqual(['code-review', 'architect'])
  })

  it('full precedence: defaults < recipe < file < env < CLI', async () => {
    const recipeDir = join(TMP, 'recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'provider: openai',
      'model: gpt-4o',
      'maxIterations: 200',
      'systemPrompt: "Recipe prompt"',
    ].join('\n'))

    writeFileSync(join(TMP, 'ra.config.yaml'), [
      'model: claude-sonnet-4-6',
      'maxIterations: 100',
    ].join('\n'))

    const config = await loadConfig({
      cwd: TMP,
      env: { RA_MAX_ITERATIONS: '50' },
      cliArgs: { provider: 'google' as const },
      recipePath: join(recipeDir, 'ra.config.yaml'),
    })

    expect(config.provider).toBe('google')          // CLI wins
    expect(config.maxIterations).toBe(50)            // env wins over file and recipe
    expect(config.model).toBe('claude-sonnet-4-6')   // file wins over recipe
    expect(config.systemPrompt).toBe('Recipe prompt') // recipe wins over default (undefined)
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

// ── defaultSkillInstallDir respects dataDir ─────────────────────────

describe('defaultSkillInstallDir respects dataDir', () => {
  it('uses dataDir from config', async () => {
    writeFileSync(join(TMP, 'ra.config.json'), JSON.stringify({ dataDir: 'custom-data' }))
    const config = await loadConfig({ cwd: TMP, env: {} })
    const skillDir = defaultSkillInstallDir(config.dataDir)
    expect(skillDir).toBe(join(TMP, 'custom-data', 'skills'))
  })

  it('defaults to .ra/skills when no dataDir override', async () => {
    const config = await loadConfig({ cwd: TMP, env: {} })
    const skillDir = defaultSkillInstallDir(config.dataDir)
    expect(skillDir).toBe(join(TMP, '.ra', 'skills'))
  })

  it('respects RA_DATA_DIR env var', async () => {
    const config = await loadConfig({ cwd: TMP, env: { RA_DATA_DIR: '/opt/ra-data' } })
    const skillDir = defaultSkillInstallDir(config.dataDir)
    expect(skillDir).toBe('/opt/ra-data/skills')
  })
})

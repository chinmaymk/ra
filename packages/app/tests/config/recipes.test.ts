import { describe, it, expect } from 'bun:test'
import { loadConfig } from '../../src/config'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'

const recipesDir = join(import.meta.dir, '..', '..', '..', '..', 'recipes')

function getRecipeDirs(): string[] {
  return readdirSync(recipesDir)
    .map(name => join(recipesDir, name))
    .filter(path => statSync(path).isDirectory())
}

describe('recipe configs', () => {
  const recipeDirs = getRecipeDirs()

  it('finds at least one recipe', () => {
    expect(recipeDirs.length).toBeGreaterThan(0)
  })

  for (const dir of recipeDirs) {
    const name = dir.split('/').pop()!

    it(`${name}: loads without error`, async () => {
      const config = await loadConfig({ cwd: dir, env: {} })
      expect(config).toBeDefined()
    })

    it(`${name}: has app and agent sections`, async () => {
      const config = await loadConfig({ cwd: dir, env: {} })
      expect(config.app).toBeDefined()
      expect(config.agent).toBeDefined()
    })

    it(`${name}: has valid provider`, async () => {
      const config = await loadConfig({ cwd: dir, env: {} })
      const validProviders = ['anthropic', 'openai', 'openai-completions', 'google', 'ollama', 'bedrock', 'azure']
      expect(validProviders).toContain(config.agent.provider)
    })

    it(`${name}: has valid interface`, async () => {
      const config = await loadConfig({ cwd: dir, env: {} })
      const validInterfaces = ['cli', 'repl', 'http', 'mcp', 'mcp-stdio', 'inspector']
      expect(validInterfaces).toContain(config.app.interface)
    })

    it(`${name}: has valid tools config`, async () => {
      const config = await loadConfig({ cwd: dir, env: {} })
      expect(typeof config.agent.tools.builtin).toBe('boolean')
      expect(config.agent.tools.overrides).toBeDefined()
    })

    it(`${name}: maxIterations is a positive number`, async () => {
      const config = await loadConfig({ cwd: dir, env: {} })
      expect(config.agent.maxIterations).toBeGreaterThan(0)
    })

    it(`${name}: does not contain app stanza`, async () => {
      const configPath = join(dir, 'ra.config.yaml')
      const content = await Bun.file(configPath).text()
      const yaml = await import('js-yaml')
      const raw = yaml.load(content) as Record<string, unknown>
      expect(raw.app).toBeUndefined()
    })
  }
})

describe('recipe validation', () => {
  it('rejects recipe with app stanza', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-recipe-test-'))
    writeFileSync(join(dir, 'ra.config.yaml'), [
      'app:',
      '  interface: http',
      'agent:',
      '  provider: anthropic',
      '  model: claude-sonnet-4-6',
    ].join('\n'))

    await expect(
      loadConfig({ recipeName: dir, cwd: dir, env: {} })
    ).rejects.toThrow('contains an "app" stanza')
  })

  it('accepts recipe with only agent stanza', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-recipe-test-'))
    writeFileSync(join(dir, 'ra.config.yaml'), [
      'agent:',
      '  provider: anthropic',
      '  model: claude-sonnet-4-6',
    ].join('\n'))

    const config = await loadConfig({ recipeName: dir, cwd: dir, env: {} })
    expect(config.agent.provider).toBe('anthropic')
  })

  it('preserves recipe custom tools through merge', async () => {
    const recipeDir = mkdtempSync(join(tmpdir(), 'ra-recipe-custom-tools-'))
    writeFileSync(join(recipeDir, 'my-tool.ts'), `
export default {
  name: 'RecipeTool',
  description: 'A tool from the recipe',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'ok' },
}
`)
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  provider: anthropic',
      '  model: claude-sonnet-4-6',
      '  tools:',
      '    custom:',
      '      - ./my-tool.ts',
    ].join('\n'))

    // User config in a separate dir that also defines tools
    const userDir = mkdtempSync(join(tmpdir(), 'ra-user-custom-tools-'))
    writeFileSync(join(userDir, 'ra.config.yaml'), [
      'agent:',
      '  tools:',
      '    builtin: true',
    ].join('\n'))

    const config = await loadConfig({ cwd: userDir, recipeName: recipeDir, env: {} })
    expect(config.agent.tools.custom).toBeDefined()
    expect(config.agent.tools.custom!.length).toBe(1)
    // Path should be pre-resolved to absolute
    expect(config.agent.tools.custom![0]).toContain('my-tool.ts')
    expect(config.agent.tools.custom![0]).not.toBe('./my-tool.ts')
  })

  it('combines recipe and user custom tools', async () => {
    const recipeDir = mkdtempSync(join(tmpdir(), 'ra-recipe-tools-merge-'))
    writeFileSync(join(recipeDir, 'recipe-tool.ts'), `
export default {
  name: 'RecipeTool',
  description: 'From recipe',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'ok' },
}
`)
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  provider: anthropic',
      '  model: claude-sonnet-4-6',
      '  tools:',
      '    custom:',
      '      - ./recipe-tool.ts',
    ].join('\n'))

    const userDir = mkdtempSync(join(tmpdir(), 'ra-user-tools-merge-'))
    writeFileSync(join(userDir, 'user-tool.ts'), `
export default {
  name: 'UserTool',
  description: 'From user',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'ok' },
}
`)
    writeFileSync(join(userDir, 'ra.config.yaml'), [
      'agent:',
      '  tools:',
      '    custom:',
      '      - ./user-tool.ts',
    ].join('\n'))

    const config = await loadConfig({ cwd: userDir, recipeName: recipeDir, env: {} })
    expect(config.agent.tools.custom).toBeDefined()
    expect(config.agent.tools.custom!.length).toBe(2)
    // Recipe tools come first
    expect(config.agent.tools.custom![0]).toContain('recipe-tool.ts')
    expect(config.agent.tools.custom![1]).toContain('user-tool.ts')
  })
})

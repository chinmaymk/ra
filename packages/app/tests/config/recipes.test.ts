import { describe, it, expect } from 'bun:test'
import { loadConfig } from '../../src/config'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'

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
  }
})

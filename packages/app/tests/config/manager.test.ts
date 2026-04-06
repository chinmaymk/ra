import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { ConfigManager } from '../../src/config/manager'
import { loadConfigWithPath } from '../../src/config'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ConfigManager', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-manager-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('does not reload when file has not changed', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { model: 'original' } }))
    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init()

    const reloaded = await manager.maybeReload()
    expect(reloaded).toBe(false)
    expect(manager.config.agent.model).toBe('original')
  })

  it('reloads when config file mtime changes', async () => {
    const configPath = join(tmp, 'ra.config.json')
    writeFileSync(configPath, JSON.stringify({ agent: { model: 'original' } }))
    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init()

    await new Promise(r => setTimeout(r, 50))
    writeFileSync(configPath, JSON.stringify({ agent: { model: 'updated' } }))

    const reloaded = await manager.maybeReload()
    expect(reloaded).toBe(true)
    expect(manager.config.agent.model).toBe('updated')
  })

  it('does not reload on second check without further changes', async () => {
    const configPath = join(tmp, 'ra.config.json')
    writeFileSync(configPath, JSON.stringify({ agent: { model: 'v1' } }))
    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init()

    await new Promise(r => setTimeout(r, 50))
    writeFileSync(configPath, JSON.stringify({ agent: { model: 'v2' } }))

    expect(await manager.maybeReload()).toBe(true)
    expect(manager.config.agent.model).toBe('v2')

    // Second check — no change
    expect(await manager.maybeReload()).toBe(false)
  })

  it('returns false when no file path is tracked', async () => {
    const loadOptions = { cwd: tmp, env: {} }
    const { config } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, undefined, loadOptions)
    await manager.init()

    expect(await manager.maybeReload()).toBe(false)
  })

  it('returns false when tracked file is deleted', async () => {
    const configPath = join(tmp, 'ra.config.json')
    writeFileSync(configPath, JSON.stringify({ agent: { model: 'test' } }))
    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init()

    rmSync(configPath)
    expect(await manager.maybeReload()).toBe(false)
  })

  it('reloads when system prompt file changes', async () => {
    const promptPath = join(tmp, 'prompt.txt')
    writeFileSync(promptPath, 'You are a pirate.')
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { systemPrompt: './prompt.txt' },
    }))

    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath, systemPromptPath } = await loadConfigWithPath(loadOptions)
    expect(config.agent.systemPrompt).toBe('You are a pirate.')
    expect(systemPromptPath).toBe(promptPath)

    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init(systemPromptPath)

    // Config file unchanged, but prompt file changes
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(promptPath, 'You are a ninja.')

    const reloaded = await manager.maybeReload()
    expect(reloaded).toBe(true)
    expect(manager.config.agent.systemPrompt).toBe('You are a ninja.')
  })

  it('reloads when a middleware file changes', async () => {
    const mwPath = join(tmp, 'my-mw.ts')
    writeFileSync(mwPath, 'export default async () => {}')
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { middleware: { beforeModelCall: [mwPath] } },
    }))

    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init()

    // Config file unchanged, but middleware file changes
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(mwPath, 'export default async (ctx) => { ctx.modified = true }')

    expect(await manager.maybeReload()).toBe(true)
  })

  it('reloads when a custom tool file changes', async () => {
    const toolPath = join(tmp, 'my-tool.ts')
    writeFileSync(toolPath, 'export default { name: "test", description: "v1", inputSchema: { type: "object" }, execute: async () => "ok" }')
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { tools: { custom: [toolPath] } },
    }))

    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init()

    // Config file unchanged, but tool file changes
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(toolPath, 'export default { name: "test", description: "v2", inputSchema: { type: "object" }, execute: async () => "ok" }')

    expect(await manager.maybeReload()).toBe(true)
  })

  it('does not track inline middleware expressions', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { middleware: { beforeModelCall: ['(ctx) => { console.log("hi") }'] } },
    }))

    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init()

    // Only the config file itself is tracked, not the inline expression
    expect(await manager.maybeReload()).toBe(false)
  })
})

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

  it('reloads when file mtime changes', async () => {
    const configPath = join(tmp, 'ra.config.json')
    writeFileSync(configPath, JSON.stringify({ agent: { model: 'original' } }))
    const loadOptions = { cwd: tmp, env: {} }
    const { config, filePath } = await loadConfigWithPath(loadOptions)
    const manager = new ConfigManager(config, filePath, loadOptions)
    await manager.init()

    // Wait a bit to ensure mtime differs, then overwrite
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
})

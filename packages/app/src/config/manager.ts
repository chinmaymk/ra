import { stat } from 'node:fs/promises'
import { loadConfigWithPath } from './index'
import type { RaConfig, LoadConfigOptions } from './types'
import type { Logger } from '@chinmaymk/ra'

/**
 * Tracks a config file's mtime and reloads when it changes.
 *
 * Call `maybeReload()` before each agent loop. If the file's mtime
 * has advanced, a fresh config is loaded and the previous one replaced.
 * Returns `true` when a reload occurred so callers can rebuild
 * derived state (provider, tools, middleware, etc.).
 */
export class ConfigManager {
  private _config: RaConfig
  private filePath: string | undefined
  private lastMtimeMs = 0
  private loadOptions: LoadConfigOptions

  constructor(
    config: RaConfig,
    filePath: string | undefined,
    loadOptions: LoadConfigOptions,
  ) {
    this._config = config
    this.filePath = filePath
    this.loadOptions = loadOptions
  }

  get config(): RaConfig { return this._config }

  /**
   * Check the config file's mtime. If it changed since the last check,
   * reload the config and return `true`. Returns `false` when no file
   * is tracked or the file hasn't changed.
   */
  async maybeReload(logger?: Logger): Promise<boolean> {
    if (!this.filePath) return false

    let mtimeMs: number
    try {
      const s = await stat(this.filePath)
      mtimeMs = s.mtimeMs
    } catch {
      return false
    }

    if (mtimeMs <= this.lastMtimeMs) return false

    this.lastMtimeMs = mtimeMs
    const { config } = await loadConfigWithPath(this.loadOptions, logger)
    this._config = config
    logger?.info('config hot-reloaded', { path: this.filePath })
    return true
  }

  /** Snapshot the current mtime so the first `maybeReload` doesn't trigger. */
  async init(): Promise<void> {
    if (!this.filePath) return
    try {
      const s = await stat(this.filePath)
      this.lastMtimeMs = s.mtimeMs
    } catch {
      // file might not exist yet — that's fine
    }
  }
}

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { loadConfigWithPath } from './index'
import type { RaConfig, LoadConfigOptions } from './types'
import type { Logger } from '@chinmaymk/ra'

/**
 * Tracks a config file AND all files it references (system prompt,
 * middleware, custom tools, skill dirs, resolvers) by mtime.
 *
 * Call `maybeReload()` before each agent loop.  If any tracked file's
 * mtime has advanced, a fresh config is loaded and `true` returned so
 * callers can rebuild derived state.
 */
export class ConfigManager {
  private _config: RaConfig
  private filePath: string | undefined
  private loadOptions: LoadConfigOptions
  /** mtime snapshot: filePath → mtimeMs */
  private mtimes = new Map<string, number>()
  /** Serializes concurrent reload attempts so only one runs at a time. */
  private reloadInFlight: Promise<boolean> | null = null

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
   * Check all tracked files' mtimes.  If any changed, reload the config
   * and return `true`.  Returns `false` when nothing changed.
   *
   * Serialized: concurrent callers share the same in-flight reload
   * so two HTTP requests don't trigger two redundant reloads.
   */
  async maybeReload(logger?: Logger): Promise<boolean> {
    if (this.reloadInFlight) return this.reloadInFlight
    this.reloadInFlight = this.doReload(logger)
    try { return await this.reloadInFlight }
    finally { this.reloadInFlight = null }
  }

  private async doReload(logger?: Logger): Promise<boolean> {
    if (this.mtimes.size === 0) return false

    const changed = await this.anyFileChanged()
    if (!changed) return false

    const { config, systemPromptPath } = await loadConfigWithPath(this.loadOptions, logger)
    this._config = config
    await this.snapshotMtimes(systemPromptPath)
    logger?.info('config hot-reloaded', { path: this.filePath })
    return true
  }

  /**
   * Snapshot mtimes of the config file and all referenced files.
   * Called once after initial load and again after each reload.
   */
  async init(systemPromptPath?: string): Promise<void> {
    await this.snapshotMtimes(systemPromptPath)
  }

  // ── Internal ──────────────────────────────────────────────────────

  /** Collect all trackable file paths from the current config. */
  private collectPaths(systemPromptPath?: string): string[] {
    const paths: string[] = []

    // Config file itself
    if (this.filePath) paths.push(this.filePath)

    // System prompt file (path is lost after inlining, so passed explicitly)
    if (systemPromptPath) paths.push(systemPromptPath)

    const { agent } = this._config

    // Middleware entries that are file paths (not inline expressions or shell commands)
    for (const entries of Object.values(agent.middleware)) {
      for (const entry of entries) {
        if (looksLikeFilePath(entry)) paths.push(entry)
      }
    }

    // Custom tool file paths
    if (agent.tools.custom) {
      for (const entry of agent.tools.custom) {
        if (looksLikeFilePath(entry)) paths.push(entry)
      }
    }

    // Web panel modules (agent.web.panels)
    if (agent.web?.panels) {
      for (const entry of agent.web.panels) {
        if (looksLikeFilePath(entry)) paths.push(entry)
      }
    }

    // Context resolver files
    if (agent.context.resolvers) {
      for (const r of agent.context.resolvers) {
        if (typeof r === 'object' && r.path && looksLikeFilePath(r.path)) {
          paths.push(r.path)
        }
      }
    }

    return paths
  }

  /** Stat all collected paths and store their mtimes. */
  private async snapshotMtimes(systemPromptPath?: string): Promise<void> {
    this.mtimes.clear()
    const paths = this.collectPaths(systemPromptPath)
    await Promise.all(paths.map(async (p) => {
      try {
        const s = await stat(p)
        this.mtimes.set(p, s.mtimeMs)
      } catch {
        // file doesn't exist or can't be stat'd — skip
      }
    }))
  }

  /** Return true if any tracked file's mtime has advanced. */
  private async anyFileChanged(): Promise<boolean> {
    const checks = [...this.mtimes.entries()].map(async ([path, lastMtime]) => {
      try {
        const s = await stat(path)
        return s.mtimeMs > lastMtime
      } catch {
        return false
      }
    })
    const results = await Promise.all(checks)
    return results.some(Boolean)
  }
}

/**
 * Heuristic: does this string look like a file path rather than
 * an inline expression or shell: command?
 */
function looksLikeFilePath(entry: string): boolean {
  if (entry.startsWith('shell:')) return false
  if (entry.startsWith('(') || entry.includes('=>')) return false
  return (
    entry.startsWith('./') || entry.startsWith('../') || entry.startsWith('~/') ||
    isAbsolute(entry) ||
    entry.endsWith('.ts') || entry.endsWith('.js') || entry.endsWith('.sh')
  )
}

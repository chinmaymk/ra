import { errorMessage } from '@chinmaymk/ra'
import { resolve } from 'path'
import type { SubCommand } from './parse-args'
import type { IMessage } from '@chinmaymk/ra'
import type { MemoryStore } from '../memory'
import type { RaConfig } from '../config/types'

/** Run --exec <script> */
export async function runExecScript(scriptPath: string): Promise<void> {
  const mod = await import(resolve(scriptPath))
  if (typeof mod.default === 'function') {
    const result = await mod.default()
    if (result !== undefined) {
      console.log(typeof result === 'string' ? result : JSON.stringify(result))
    }
  }
}

/** Format source metadata for display */
function formatSource(source?: { registry: string; package?: string; repo?: string; version?: string }): string {
  if (!source) return ''
  return ' (' + source.registry + (source.package ? ': ' + source.package : '') + (source.repo ? ': ' + source.repo : '') + (source.version ? '@' + source.version : '') + ')'
}

/** Registry operations for a given kind (skill or recipe) */
interface RegistryOps {
  install(source: string): Promise<string | string[]>
  remove(name: string): Promise<void>
  list(): Promise<Array<{ name: string; source?: { registry: string; package?: string; repo?: string; version?: string } }>>
  defaultDir(): string
}

async function loadRegistryOps(kind: 'skill' | 'recipe'): Promise<RegistryOps> {
  if (kind === 'skill') {
    const { installSkill, removeSkill, listInstalledSkills, defaultSkillInstallDir } = await import('../skills/registry')
    return { install: installSkill, remove: removeSkill, list: listInstalledSkills, defaultDir: defaultSkillInstallDir }
  }
  const { installRecipe, removeRecipe, listInstalledRecipes, defaultRecipeInstallDir } = await import('../recipes/registry')
  return { install: installRecipe, remove: removeRecipe, list: listInstalledRecipes, defaultDir: defaultRecipeInstallDir }
}

/** Handle `ra login <provider>` subcommand. */
async function runLoginCommand(cmd: SubCommand): Promise<void> {
  switch (cmd.action) {
    case 'codex': {
      const deviceCode = cmd.args.includes('--device-code')
      const { loginCodex } = await import('../auth/codex')
      try {
        await loginCodex({ deviceCode })
      } catch (err) {
        console.error('Login failed:', errorMessage(err))
        process.exit(1)
      }
      process.exit(0)
      break
    }
    case 'claude': {
      const proc = Bun.spawn(['claude', 'auth', 'login'], {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      })
      const exitCode = await proc.exited
      process.exit(exitCode)
      break
    }
    default:
      console.error(`Unknown login provider: ${cmd.action}`)
      console.error('Supported providers: codex, claude')
      process.exit(1)
  }
}

/** Handle `ra skill|recipe install|remove|list` subcommands. Exits the process. */
export async function runSubCommand(cmd: SubCommand): Promise<void> {
  if (cmd.kind === 'login') return runLoginCommand(cmd)
  if (cmd.kind === 'secrets') {
    const { runSecretsCommand } = await import('../secrets/commands')
    runSecretsCommand(cmd.action, cmd.args)
    process.exit(0)
  }

  const { kind, action, args } = cmd
  const ops = await loadRegistryOps(kind)

  switch (action) {
    case 'install': {
      if (args.length === 0) {
        console.error(`Usage: ra ${kind} install <source>`)
        process.exit(1)
      }
      for (const source of args) {
        try {
          const installed = await ops.install(source)
          const names = Array.isArray(installed) ? installed.join(', ') : installed
          console.log(`Installed ${kind}:`, names, '→', ops.defaultDir())
        } catch (err) {
          console.error(`Failed to install ${kind}:`, source, errorMessage(err))
          process.exit(1)
        }
      }
      process.exit(0)
    }
    case 'remove': {
      if (args.length === 0) {
        console.error(`Usage: ra ${kind} remove <name>`)
        process.exit(1)
      }
      for (const name of args) {
        try {
          await ops.remove(name)
          console.log(`Removed ${kind}:`, name)
        } catch (err) {
          console.error(`Failed to remove ${kind}:`, name, errorMessage(err))
          process.exit(1)
        }
      }
      process.exit(0)
    }
    case 'list': {
      const items = await ops.list()
      if (items.length === 0) {
        console.log(`No ${kind}s installed in`, ops.defaultDir())
      } else {
        for (const item of items) {
          console.log('  ' + item.name + formatSource(item.source))
        }
      }
      process.exit(0)
    }
  }
}

/** Handle --show-context */
export function showContext(contextMessages: IMessage[]): void {
  if (contextMessages.length === 0) {
    console.log('No context files discovered.')
  } else {
    for (const msg of contextMessages) {
      console.log(typeof msg.content === 'string' ? msg.content : '')
      console.log()
    }
  }
}

/** Handle --list-memories, --memories, --forget */
export function runMemoryCommand(
  memoryStore: MemoryStore | undefined,
  opts: { list?: boolean; search?: string; forget?: string },
): void {
  if (!memoryStore) {
    console.log('Memory is not enabled. Use --memory or set memory.enabled in config.')
    return
  }

  if (opts.forget !== undefined) {
    if (!opts.forget) {
      console.log('Usage: ra --forget "search query"')
    } else {
      const deleted = memoryStore.forget(opts.forget, 1000)
      console.log(deleted > 0 ? 'Forgot ' + deleted + ' memory(s).' : 'No matching memories found.')
    }
    return
  }

  const query = opts.search || ''
  const memories = query ? memoryStore.search(query, 100) : memoryStore.list(100)
  if (memories.length === 0) {
    console.log(query ? 'No matching memories found.' : 'No memories stored.')
  } else {
    const total = memoryStore.count()
    console.log(query
      ? memories.length + ' matching memories (' + total + ' total):\n'
      : memories.length + ' memories (' + total + ' total):\n')
    for (const m of memories) {
      console.log('  [' + m.id + '] [' + (m.tags || 'general') + '] ' + m.content)
    }
  }
}

const REDACT_KEYS = new Set(['token', 'apiKey', 'api_key', 'secret', 'password', 'accessToken', 'access_token'])

/** Handle --show-config: print resolved config as JSON with secrets redacted. */
export function showConfig(config: RaConfig, contextFiles: string[] = []): void {
  const redacted = JSON.parse(JSON.stringify(config, (_key, value) => {
    if (typeof value === 'string' && REDACT_KEYS.has(_key) && value) return '***'
    return value
  }))
  // Drop non-serializable fields (callbacks)
  delete redacted.agent?.compaction?.onCompact
  if (contextFiles.length > 0) redacted.agent.context.files = contextFiles
  console.log(JSON.stringify(redacted, null, 2))
}

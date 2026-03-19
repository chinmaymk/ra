import { errorMessage } from '@chinmaymk/ra'
import { resolve } from 'path'
import type { PackageCommand } from './parse-args'
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

function formatSource(source: { registry: string; package?: string; repo?: string; version?: string; url?: string }): string {
  const parts: string[] = [source.registry]
  if (source.package) parts.push(`: ${source.package}`)
  else if (source.repo) parts.push(`: ${source.repo}`)
  if (source.version) parts.push(`@${source.version}`)
  return ` (${parts.join('')})`
}

/** Handle `ra install|remove|list` subcommands. Exits the process. */
export async function runPackageCommand(cmd: PackageCommand): Promise<void> {
  const reg = await import('../skills/registry')
  const { kind, action, args } = cmd

  // `ra list` lists both recipes and skills
  if (action === 'list') {
    const recipes = await reg.listInstalledRecipes()
    const skills = await reg.listInstalledSkills()

    if (recipes.length === 0 && skills.length === 0) {
      console.log(`No recipes installed in ${reg.defaultRecipeInstallDir()}`)
      console.log(`No skills installed in ${reg.defaultSkillInstallDir()}`)
    } else {
      if (recipes.length > 0) {
        console.log('Recipes:')
        for (const r of recipes) {
          const src = r.source ? formatSource(r.source) : ''
          console.log(`  ${r.name}${src}`)
        }
      }
      if (skills.length > 0) {
        if (recipes.length > 0) console.log()
        console.log('Skills:')
        for (const s of skills) {
          const src = s.source ? formatSource(s.source) : ''
          console.log(`  ${s.name}${src}`)
        }
      }
    }
    process.exit(0)
  }

  if (kind === 'recipe') {
    switch (action) {
      case 'install': {
        if (args.length === 0) {
          console.error('Usage: ra install recipe <source>')
          process.exit(1)
        }
        for (const source of args) {
          try {
            const installed = await reg.installRecipe(source)
            for (const name of installed) {
              console.log(`Installed recipe: ${name} → ${reg.defaultRecipeInstallDir()}/${name}`)
            }
          } catch (err) {
            console.error(`Failed to install recipe "${source}": ${errorMessage(err)}`)
            process.exit(1)
          }
        }
        process.exit(0)
      }
      case 'remove': {
        if (args.length === 0) {
          console.error('Usage: ra remove recipe <name>')
          process.exit(1)
        }
        for (const name of args) {
          try {
            await reg.removeRecipe(name)
            console.log(`Removed recipe: ${name}`)
          } catch (err) {
            console.error(`Failed to remove recipe "${name}": ${errorMessage(err)}`)
            process.exit(1)
          }
        }
        process.exit(0)
      }
    }
  }

  if (kind === 'skill') {
    switch (action) {
      case 'install': {
        if (args.length === 0) {
          console.error('Usage: ra install skill <source>')
          process.exit(1)
        }
        for (const source of args) {
          try {
            const installed = await reg.installSkill(source)
            console.log(`Installed skills: ${installed.join(', ')} → ${reg.defaultSkillInstallDir()}`)
          } catch (err) {
            console.error(`Failed to install skill "${source}": ${errorMessage(err)}`)
            process.exit(1)
          }
        }
        process.exit(0)
      }
      case 'remove': {
        if (args.length === 0) {
          console.error('Usage: ra remove skill <name>')
          process.exit(1)
        }
        for (const name of args) {
          try {
            await reg.removeSkill(name)
            console.log(`Removed skill: ${name}`)
          } catch (err) {
            console.error(`Failed to remove skill "${name}": ${errorMessage(err)}`)
            process.exit(1)
          }
        }
        process.exit(0)
      }
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

const REDACT_KEYS = new Set(['token', 'apiKey', 'api_key', 'secret', 'password'])

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

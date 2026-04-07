/**
 * `ra secrets` subcommand handlers.
 *
 * Surface:
 *   ra secrets set <NAME> <value> [--profile <name>]
 *   ra secrets get <NAME>          [--profile <name>]
 *   ra secrets list                [--profile <name>] [--all]
 *   ra secrets remove <NAME>       [--profile <name>]
 *   ra secrets profiles
 *   ra secrets path
 */

import {
  getSecretsPath,
  DEFAULT_PROFILE,
  loadSecretsSync,
  setSecret,
  getSecret,
  removeSecret,
  listProfiles,
  getProfileSecrets,
  maskSecret,
} from './store'

interface ParsedSecretArgs {
  profile: string
  showAll: boolean
  positionals: string[]
}

/** Tiny argument parser specific to the secrets subcommand. */
function parseSecretArgs(args: string[]): ParsedSecretArgs {
  let profile = process.env.RA_PROFILE ?? DEFAULT_PROFILE
  let showAll = false
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--profile' && args[i + 1]) {
      profile = args[i + 1]!
      i++
    } else if (a.startsWith('--profile=')) {
      profile = a.slice('--profile='.length)
    } else if (a === '--all') {
      showAll = true
    } else {
      positionals.push(a)
    }
  }
  return { profile, showAll, positionals }
}

function usage(): never {
  console.error([
    'Usage:',
    '  ra secrets set <NAME> <value> [--profile <name>]',
    '  ra secrets get <NAME>          [--profile <name>]',
    '  ra secrets list                [--profile <name>] [--all]',
    '  ra secrets remove <NAME>       [--profile <name>]',
    '  ra secrets profiles',
    '  ra secrets path',
  ].join('\n'))
  process.exit(1)
}

export function runSecretsCommand(action: string, args: string[]): void {
  const { profile, showAll, positionals } = parseSecretArgs(args)

  switch (action) {
    case 'set': {
      const [name, value] = positionals
      if (!name || value === undefined) usage()
      setSecret(name, value, profile)
      console.log(`Stored ${name} in profile "${profile}" → ${getSecretsPath()}`)
      return
    }

    case 'get': {
      const [name] = positionals
      if (!name) usage()
      const value = getSecret(name, profile)
      if (value === undefined) {
        console.error(`No secret "${name}" in profile "${profile}"`)
        process.exit(1)
      }
      // Print raw value (newline-terminated) so callers can pipe it
      // into other tools without having to strip formatting.
      console.log(value)
      return
    }

    case 'remove':
    case 'rm':
    case 'unset': {
      const [name] = positionals
      if (!name) usage()
      const removed = removeSecret(name, profile)
      if (!removed) {
        console.error(`No secret "${name}" in profile "${profile}"`)
        process.exit(1)
      }
      console.log(`Removed ${name} from profile "${profile}"`)
      return
    }

    case 'list':
    case 'ls': {
      if (showAll) {
        const all = loadSecretsSync()
        const profiles = Object.keys(all).sort()
        if (profiles.length === 0) {
          console.log(`No secrets stored. (${getSecretsPath()})`)
          return
        }
        for (const p of profiles) {
          console.log(`[${p}]`)
          for (const [k, v] of Object.entries(all[p]!)) {
            console.log(`  ${k} = ${maskSecret(v)}`)
          }
        }
        return
      }

      const entries = getProfileSecrets(profile)
      const keys = Object.keys(entries).sort()
      if (keys.length === 0) {
        console.log(`No secrets in profile "${profile}". (${getSecretsPath()})`)
        return
      }
      console.log(`[${profile}]`)
      for (const k of keys) {
        console.log(`  ${k} = ${maskSecret(entries[k]!)}`)
      }
      return
    }

    case 'profiles': {
      const profiles = listProfiles()
      if (profiles.length === 0) {
        console.log(`No profiles. (${getSecretsPath()})`)
        return
      }
      const all = loadSecretsSync()
      for (const p of profiles) {
        const count = Object.keys(all[p] ?? {}).length
        console.log(`  ${p}  (${count} secret${count === 1 ? '' : 's'})`)
      }
      return
    }

    case 'path': {
      console.log(getSecretsPath())
      return
    }

    default:
      usage()
  }
}

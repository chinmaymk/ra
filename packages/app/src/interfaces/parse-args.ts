import yargs from 'yargs'
import { setPath } from '../utils/config-helpers'
import { buildMergedEnv, DEFAULT_PROFILE } from '../secrets/store'
import {
  OPTIONS,
  OPTIONS_BY_NAME,
  PROVIDER_SCOPED,
  INTERFACE_SCOPED,
  INTERFACE_FLAGS,
  coerceOptionValue,
  type OptionDef,
  type Provider,
  type InterfaceFlag,
  type MetaKey,
} from '../config/schema'
import type { RaConfig } from '../config/types'

export type SubCommand =
  | { kind: 'skill' | 'recipe'; action: 'install' | 'remove' | 'list'; args: string[] }
  | { kind: 'login'; action: string; args: string[] }
  | { kind: 'secrets'; action: string; args: string[] }

export interface ParsedArgsMeta {
  help: boolean
  version: boolean
  files: string[]
  prompt?: string
  resume?: string | true
  configPath?: string
  exec?: string
  showContext: boolean
  showConfig: boolean
  runImmediately: boolean
  listMemories: boolean
  memories?: string
  forget?: string
  subCommand?: SubCommand
  recipeName?: string
}

export interface ParsedArgs {
  config: Partial<RaConfig>
  meta: ParsedArgsMeta
}

const SUBCOMMAND_KINDS = new Set(['skill', 'recipe'])
const SUBCOMMAND_ACTIONS = new Set(['install', 'remove', 'list'])

/** Detect skill/recipe/login/secrets subcommands. Returns null if not a subcommand. */
function parseSubcommand(userArgs: string[]): SubCommand | null {
  const head = userArgs[0]
  if (!head) return null

  if (SUBCOMMAND_KINDS.has(head) && userArgs[1] && SUBCOMMAND_ACTIONS.has(userArgs[1])) {
    return {
      kind: head as 'skill' | 'recipe',
      action: userArgs[1] as 'install' | 'remove' | 'list',
      args: userArgs.slice(2),
    }
  }
  if (head === 'login')   return { kind: 'login',   action: userArgs[1] ?? 'codex', args: userArgs.slice(2) }
  if (head === 'secrets') return { kind: 'secrets', action: userArgs[1] ?? 'list',  args: userArgs.slice(2) }
  return null
}

/**
 * Pull a flag with a value out of `args` before yargs sees it.
 *
 * `consumeNext: true`  → `--flag value` and `--flag=value` (required value)
 * `consumeNext: false` → `--flag` (no value) and `--flag=value` (optional value)
 *
 * Used for `--profile` (must be known before yargs builds defaults from
 * the secrets store) and `--resume` (optional value can't be expressed
 * inside yargs without ambiguating positional prompts).
 */
function extractFlag(
  args: string[],
  flag: string,
  consumeNext: boolean,
): { rest: string[]; value: string | true | undefined } {
  let value: string | true | undefined
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === flag) {
      if (consumeNext && args[i + 1] !== undefined) {
        value = args[i + 1]
        i++
      } else {
        value = true
      }
    } else if (a.startsWith(`${flag}=`)) {
      value = a.slice(flag.length + 1)
    } else {
      rest.push(a)
    }
  }
  return { rest, value }
}

// ── Parser ──────────────────────────────────────────────────────────────

/**
 * Build a yargs parser. Every option, alias, and choice list comes straight
 * from the `OPTIONS` table in `config/schema.ts` — there is no parallel
 * declaration to drift out of sync.
 */
function buildYargs(args: string[]) {
  const interfaceConflicts = Object.fromEntries(
    INTERFACE_FLAGS.map(f => [f, INTERFACE_FLAGS.filter(x => x !== f)]),
  )

  let y = yargs(args)
    .help(false)
    .version(false)
    .exitProcess(false)
    .strict()
    // Bind every declared option to a matching `RA_*` environment variable
    // (RA_HTTP_PORT ↔ --http-port, etc.). CLI flags still take precedence.
    .env('RA')
    // Default command accepts positional prompt tokens; required to keep
    // strict mode from rejecting them as "unknown arguments".
    .command('$0 [prompt..]', false, y => y.positional('prompt', { type: 'string', array: true }), () => {})
    .parserConfiguration({
      // camel-case-expansion stays ON so .env('RA') resolves
      // RA_HTTP_PORT → httpPort → http-port. We compensate by reading
      // dashed names from argv below.
      'strip-aliased': true,
      'boolean-negation': false,        // disable --no-foo magic
      'parse-numbers': false,           // OPTIONS coerce: 'int' handles ints
      'parse-positional-numbers': false,// keep positionals as raw strings
      'greedy-arrays': false,           // --skill-dir /a /b assigns only /a
    })
    .conflicts(interfaceConflicts)
    .check(checkScopedFlags)
    .fail((msg, err) => {
      // yargs invokes .fail() for parse errors, strict-mode unknown flags,
      // .conflicts() / .check() violations, and invalid .choices(). Throw
      // them all so callers see one consistent failure mode.
      throw err ?? new Error(msg)
    })

  for (const opt of OPTIONS) {
    y = y.option(opt.name, {
      type: opt.type,
      ...(opt.choices && { choices: opt.choices as readonly string[] }),
      ...(opt.array   && { array: true }),
      ...(opt.alias   && { alias: opt.alias }),
      ...(opt.hidden  && { hidden: true }),
    })
  }

  return y
}

/**
 * Single declarative validator for both provider- and interface-scoped flags.
 *
 * Skips when the context flag (--provider or an interface flag) is omitted
 * on the CLI: config files and recipes may still supply the missing context.
 * If the context flag IS given, the scoped flag must agree with it.
 */
function checkScopedFlags(argv: Record<string, unknown>): true {
  const provider = argv.provider as Provider | undefined
  for (const [flag, allowed] of Object.entries(PROVIDER_SCOPED)) {
    if (argv[flag] === undefined || provider === undefined) continue
    if (!allowed.includes(provider)) {
      throw new Error(
        `--${flag} is only valid with --provider ${allowed.map(p => `"${p}"`).join(' or ')} (got --provider "${provider}")`,
      )
    }
  }

  const activeInterface = INTERFACE_FLAGS.find(f => argv[f]) as InterfaceFlag | undefined
  for (const [flag, allowed] of Object.entries(INTERFACE_SCOPED)) {
    if (argv[flag] === undefined || activeInterface === undefined) continue
    if (!allowed.includes(activeInterface)) {
      throw new Error(
        `--${flag} is only valid with ${allowed.map(i => `--${i}`).join(' or ')} (got --${activeInterface})`,
      )
    }
  }

  return true
}

export function parseArgs(argv: string[]): ParsedArgs {
  // Detect dev (`bun src/index.ts ...`) vs compiled binary (`/usr/local/bin/ra ...`).
  const isScriptPath = argv[1] !== undefined && (
    /\.(ts|js|mjs|cjs)$/.test(argv[1]) || argv[1].startsWith('/$bunfs/')
  )
  const userArgs = argv.slice(isScriptPath ? 2 : 1)

  const sub = parseSubcommand(userArgs)
  if (sub) return { config: {}, meta: emptyMeta(sub) }

  // Pre-extract --resume (optional value) and --profile (must be known
  // before yargs builds defaults from the secrets store) ahead of yargs.
  const { rest: afterResume,  value: resume }  = extractFlag(userArgs,  '--resume',  false)
  const { rest: afterProfile, value: profileV } = extractFlag(afterResume, '--profile', true)
  const profile = typeof profileV === 'string' && profileV.length > 0
    ? profileV
    : (process.env.RA_PROFILE || DEFAULT_PROFILE)

  // Real process.env wins over the secrets file so a one-shot
  // `OPENAI_API_KEY=foo ra ...` invocation still does what users expect.
  const lookupEnv = buildMergedEnv(profile)

  const values = buildYargs(afterProfile).parseSync() as Record<string, unknown>

  // Fill missing values from standard env vars AFTER `checkScopedFlags`
  // ran, so an unrelated env var like `OPENAI_BASE_URL` doesn't trip the
  // scoped check when the user runs `--provider anthropic`. Empty strings
  // are treated as unset.
  for (const opt of OPTIONS) {
    if (!opt.env || values[opt.name] !== undefined) continue
    const fromEnv = lookupEnv[opt.env]
    if (fromEnv && fromEnv.length > 0) values[opt.name] = fromEnv
  }

  // Default command `$0 [prompt..]` puts positionals into `prompt`; fall
  // back to `_` for safety when no positionals were given.
  const positionals = (
    (values.prompt as unknown[] | undefined)
    ?? (values._ as unknown[] | undefined)
    ?? []
  ).map(p => String(p))

  const config: Record<string, unknown> = {}
  const meta = emptyMeta()
  meta.resume = resume
  meta.prompt = positionals.length > 0 ? positionals.join(' ') : undefined

  // Walk OPTIONS once. Each option either lands in config (path) or meta.
  for (const opt of OPTIONS) {
    const val = values[opt.name]
    if (val === undefined) continue

    if (opt.meta) {
      writeMeta(meta, opt.meta, val, opt)
      continue
    }

    if (!opt.path) continue
    const out = coerceOptionValue(opt, val)
    if (out === undefined) continue
    setPath(config, opt.path as string[], out)
    if (opt.dual) setPath(config, opt.dual as string[], out)
  }

  // Interface selection. Mutual exclusion is enforced by yargs .conflicts(),
  // so at most one of these will be truthy.
  const activeInterface = INTERFACE_FLAGS.find(f => values[f])
  if (activeInterface) setPath(config, ['app', 'interface'], activeInterface)

  // --memory, --list-memories, --memories, and --forget all imply memory enabled.
  if (values.memory || values['list-memories'] || values.memories || values.forget) {
    setPath(config, ['agent', 'memory', 'enabled'], true)
  }

  return { config: config as Partial<RaConfig>, meta }
}

/** Build a fresh ParsedArgsMeta with all required-boolean fields defaulted to false. */
function emptyMeta(subCommand?: SubCommand): ParsedArgsMeta {
  return {
    help: false,
    version: false,
    showContext: false,
    showConfig: false,
    runImmediately: false,
    listMemories: false,
    files: [],
    ...(subCommand && { subCommand }),
  }
}

/** Write a single meta value, applying the right type for the key. */
function writeMeta(meta: ParsedArgsMeta, key: MetaKey, val: unknown, opt: OptionDef): void {
  const target = meta as unknown as Record<string, unknown>
  if (opt.array) {
    target[key] = val ?? []
  } else if (opt.type === 'boolean') {
    target[key] = Boolean(val)
  } else {
    target[key] = val
  }
}

// Re-export so existing imports keep working without churn.
export { OPTIONS_BY_NAME }

import yargs from 'yargs'
import { setPath, applyRule } from '../utils/config-helpers'
import { buildMergedEnv, DEFAULT_PROFILE } from '../secrets/store'
import {
  PROVIDERS,
  INTERFACE_FLAGS,
  THINKING_LEVELS,
  PROVIDER_SCOPED,
  INTERFACE_SCOPED,
  STANDARD_ENV,
  FLAG_RULES,
  type Provider,
  type InterfaceFlag,
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

// FLAG_RULES, STANDARD_ENV, buildStandardEnvLayer, PROVIDERS, INTERFACE_FLAGS,
// PROVIDER_SCOPED, and INTERFACE_SCOPED all live in `config/schema.ts` so the
// CLI parser and `loadConfig` share a single source of truth.

const EMPTY_META = (): ParsedArgsMeta => ({
  help: false,
  version: false,
  showContext: false,
  showConfig: false,
  runImmediately: false,
  listMemories: false,
  files: [],
})

/** Detect whether argv begins with `<runtime> <script>` (dev mode) vs a compiled binary. */
function stripArgvPrefix(argv: string[]): string[] {
  const isScriptPath = argv[1] !== undefined && (
    /\.(ts|js|mjs|cjs)$/.test(argv[1]) || argv[1].startsWith('/$bunfs/')
  )
  return argv.slice(isScriptPath ? 2 : 1)
}

/** Detect skill/recipe/login subcommands. Returns null if not a subcommand. */
function parseSubcommand(userArgs: string[]): ParsedArgs | null {
  const SUB_KINDS = ['skill', 'recipe'] as const
  const kind = userArgs[0] as typeof SUB_KINDS[number]
  if (SUB_KINDS.includes(kind) && userArgs[1] && ['install', 'remove', 'list'].includes(userArgs[1])) {
    return {
      config: {},
      meta: {
        ...EMPTY_META(),
        subCommand: { kind, action: userArgs[1] as 'install' | 'remove' | 'list', args: userArgs.slice(2) },
      },
    }
  }

  if (userArgs[0] === 'login') {
    const provider = userArgs[1] ?? 'codex'
    return {
      config: {},
      meta: {
        ...EMPTY_META(),
        subCommand: { kind: 'login', action: provider, args: userArgs.slice(2) },
      },
    }
  }

  if (userArgs[0] === 'secrets') {
    const action = userArgs[1] ?? 'list'
    return {
      config: {},
      meta: {
        ...EMPTY_META(),
        subCommand: { kind: 'secrets', action, args: userArgs.slice(2) },
      },
    }
  }

  return null
}

/**
 * Extract `--profile <name>` and `--profile=<name>` from the args list.
 * Falls back to `RA_PROFILE`, then to `DEFAULT_PROFILE`. We strip it
 * before yargs sees it because the resolved profile must be known at
 * parser-construction time (it picks which secrets are loaded).
 */
function extractProfile(args: string[]): { rest: string[]; profile: string } {
  let profile = process.env.RA_PROFILE || DEFAULT_PROFILE
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--profile' && args[i + 1] !== undefined) {
      profile = args[i + 1]!
      i++
    } else if (a.startsWith('--profile=')) {
      profile = a.slice('--profile='.length)
    } else {
      rest.push(a)
    }
  }
  return { rest, profile }
}

/**
 * Extract `--resume` and `--resume=<id>` from the args list.
 * `--resume` is special: it accepts an OPTIONAL value, which yargs cannot
 * express natively (it would either always consume the next token, or never).
 * We strip it before handing the rest to yargs, then merge the result back.
 */
function extractResume(args: string[]): { rest: string[]; resume: string | true | undefined } {
  let resume: string | true | undefined
  const rest: string[] = []
  for (const arg of args) {
    if (arg === '--resume') {
      resume = true
    } else if (arg.startsWith('--resume=')) {
      resume = arg.slice('--resume='.length)
    } else {
      rest.push(arg)
    }
  }
  return { rest, resume }
}

// ── Parser ──────────────────────────────────────────────────────────────

/**
 * Build a yargs parser with all known options. Numeric flags are declared
 * as strings so `safeParseInt` can silently drop invalid input via
 * FLAG_RULES (matches the historical lenient int coercion).
 */
function buildYargs(args: string[]) {
  // Each interface flag conflicts with every other interface flag.
  const interfaceConflicts = Object.fromEntries(
    INTERFACE_FLAGS.map(f => [f, INTERFACE_FLAGS.filter(x => x !== f)]),
  )

  return yargs(args)
    .help(false)
    .version(false)
    .exitProcess(false)
    .strict()
    // Bind every declared option to a matching `RA_*` environment variable.
    // yargs lowercases and converts `_` → `-`, so e.g.
    //   RA_PROVIDER=openai             ↔ --provider openai
    //   RA_HTTP_PORT=4000              ↔ --http-port 4000
    //   RA_OPENAI_BASE_URL=https://x   ↔ --openai-base-url https://x
    // CLI flags still take precedence; env values flow through .choices(),
    // .conflicts(), and checkScopedFlags identically.
    .env('RA')
    // Declare a default command that accepts any number of positional
    // prompt tokens, so strict mode doesn't reject the prompt itself.
    .command('$0 [prompt..]', false, y => y.positional('prompt', { type: 'string', array: true }), () => {})
    .parserConfiguration({
      // camel-case-expansion stays ON so .env('RA') can resolve
      // RA_HTTP_PORT → httpPort → http-port. We compensate for the
      // dual keys by always reading dashed names from argv below.
      'strip-aliased': true,            // drop alias keys (h, v) from the result
      'boolean-negation': false,        // disable --no-foo magic
      'parse-numbers': false,           // FLAG_RULES handles int coercion
      'parse-positional-numbers': false,// keep positionals as raw strings
      'greedy-arrays': false,           // --skill-dir /a /b assigns only /a
    })
    // Meta flags
    .option('exec',                          { type: 'string' })
    .option('config',                        { type: 'string' })
    .option('file',                          { type: 'string', array: true })
    .option('help',                          { type: 'boolean', alias: 'h' })
    .option('version',                       { type: 'boolean', alias: 'v' })
    .option('show-context',                  { type: 'boolean' })
    .option('show-config',                   { type: 'boolean' })
    // Interface selection (mutually exclusive — see .conflicts() below)
    .option('http',                          { type: 'boolean' })
    .option('cli',                           { type: 'boolean' })
    .option('repl',                          { type: 'boolean' })
    .option('mcp',                           { type: 'boolean' })
    .option('mcp-stdio',                     { type: 'boolean' })
    .option('inspector',                     { type: 'boolean' })
    .option('cron',                          { type: 'boolean' })
    .option('run-immediately',               { type: 'boolean' })
    .conflicts(interfaceConflicts)
    // Agent config (numerics declared as strings; coerced via FLAG_RULES)
    .option('provider',                      { type: 'string', choices: PROVIDERS })
    .option('model',                         { type: 'string' })
    .option('system-prompt',                 { type: 'string' })
    .option('max-iterations',                { type: 'string' })
    .option('thinking',                      { type: 'string', choices: THINKING_LEVELS })
    .option('thinking-budget-cap',           { type: 'string' })
    .option('tool-timeout',                  { type: 'string' })
    .option('max-tool-response-size',        { type: 'string' })
    .option('tools-builtin',                 { type: 'boolean' })
    // HTTP server
    .option('http-port',                     { type: 'string' })
    .option('http-token',                    { type: 'string' })
    // Inspector
    .option('inspector-port',                { type: 'string' })
    // MCP server (independent of interface — can run alongside any interface)
    .option('mcp-server-enabled',            { type: 'boolean' })
    .option('mcp-server-port',               { type: 'string' })
    .option('mcp-server-tool-name',          { type: 'string' })
    .option('mcp-server-tool-description',   { type: 'string' })
    // Memory
    .option('memory',                        { type: 'boolean' })
    .option('list-memories',                 { type: 'boolean' })
    .option('memories',                      { type: 'string' })
    .option('forget',                        { type: 'string' })
    // Data & storage
    .option('data-dir',                      { type: 'string' })
    .option('storage-max-sessions',          { type: 'string' })
    .option('storage-ttl-days',              { type: 'string' })
    // Skills & recipes
    .option('skill-dir',                     { type: 'string', array: true })
    .option('recipe',                        { type: 'string' })
    // Provider connection options (validated by checkScopedFlags)
    .option('anthropic-base-url',            { type: 'string' })
    .option('openai-base-url',               { type: 'string' })
    .option('google-base-url',               { type: 'string' })
    .option('ollama-host',                   { type: 'string' })
    .option('bedrock-base-url',              { type: 'string' })
    .option('azure-endpoint',                { type: 'string' })
    .option('azure-deployment',              { type: 'string' })
    // Hidden credential flags. These exist purely so that standard env
    // vars and the secrets store can flow into the same nested config
    // paths as everything else. Marked `hidden: true` so they don't
    // appear in --help (we don't want users putting raw API keys into
    // shell history). They are still accepted on the CLI if explicitly
    // passed; strict mode requires them to be declared somewhere.
    .option('anthropic-api-key',             { type: 'string', hidden: true })
    .option('openai-api-key',                { type: 'string', hidden: true })
    .option('google-api-key',                { type: 'string', hidden: true })
    .option('azure-api-key',                 { type: 'string', hidden: true })
    .option('aws-access-key-id',             { type: 'string', hidden: true })
    .option('aws-secret-access-key',         { type: 'string', hidden: true })
    .option('aws-session-token',             { type: 'string', hidden: true })
    .option('aws-region',                    { type: 'string', hidden: true })
    .option('bedrock-api-key',               { type: 'string', hidden: true })
    .option('codex-access-token',            { type: 'string', hidden: true })
    // Acknowledge `RA_SECRETS_PATH` and `RA_PROFILE` so yargs `.env('RA')`
    // doesn't reject them under strict mode. Both are read directly:
    //   - secrets path via `getSecretsPath()` in secrets/store.ts
    //   - profile via `extractProfile()` above (pre-stripped from args)
    .option('secrets-path',                  { type: 'string', hidden: true })
    .option('profile',                       { type: 'string', hidden: true })
    .check(checkScopedFlags)
    .fail((msg, err) => {
      // yargs calls .fail() for parse errors, strict-mode unknown flags,
      // .conflicts() / .implies() / .check() violations, and invalid
      // .choices(). Surface them all as thrown Errors so callers see a
      // single, consistent failure mode.
      throw err ?? new Error(msg)
    })
}

/**
 * Single declarative validator for both provider- and interface-scoped flags.
 *
 * The rule for both groups is the same: if the "context" flag (--provider or
 * an interface flag) is omitted on the CLI, accept the scoped flag silently
 * — config files and recipes may still supply the missing context. If the
 * context flag IS given, the scoped flag must agree with it.
 */
function checkScopedFlags(argv: Record<string, unknown>): true {
  const provider = argv.provider as Provider | undefined
  for (const [flag, allowed] of Object.entries(PROVIDER_SCOPED)) {
    if (argv[flag] === undefined || provider === undefined) continue
    if (!allowed.includes(provider)) {
      throw new Error(
        `--${flag} is only valid with --provider ${quoteList(allowed)} (got --provider "${provider}")`,
      )
    }
  }

  const activeInterface = INTERFACE_FLAGS.find(f => argv[f])
  for (const [flag, allowed] of Object.entries(INTERFACE_SCOPED)) {
    if (argv[flag] === undefined || activeInterface === undefined) continue
    if (!allowed.includes(activeInterface as InterfaceFlag)) {
      throw new Error(
        `--${flag} is only valid with ${allowed.map(i => `--${i}`).join(' or ')} (got --${activeInterface})`,
      )
    }
  }

  return true
}

function quoteList(items: readonly string[]): string {
  return items.map(p => `"${p}"`).join(' or ')
}

export function parseArgs(argv: string[]): ParsedArgs {
  const userArgs = stripArgvPrefix(argv)

  const sub = parseSubcommand(userArgs)
  if (sub) return sub

  const { rest: afterResume, resume } = extractResume(userArgs)
  const { rest: afterProfile, profile } = extractProfile(afterResume)

  // Build the lookup env that will fill in standard-env defaults below.
  // Real `process.env` always wins over the secrets file so a one-shot
  // `OPENAI_API_KEY=foo ra ...` invocation works exactly as expected.
  const lookupEnv = buildMergedEnv(profile)

  const values = buildYargs(afterProfile).parseSync() as Record<string, unknown>

  // Fill missing values from STANDARD_ENV. This runs AFTER yargs (and
  // therefore AFTER `checkScopedFlags`), so an unrelated env var like
  // `OPENAI_BASE_URL` doesn't trip the scoped check when the user runs
  // `--provider anthropic`. Empty strings are treated as unset.
  for (const [flag, envName] of Object.entries(STANDARD_ENV)) {
    if (values[flag] !== undefined) continue
    const fromEnv = lookupEnv[envName]
    if (fromEnv && fromEnv.length > 0) values[flag] = fromEnv
  }

  // The default command `$0 [prompt..]` puts positional tokens into `prompt`.
  // Fall back to `_` for safety (e.g. if no positionals were given).
  const positionals = (
    (values.prompt as unknown[] | undefined)
    ?? (values._ as unknown[] | undefined)
    ?? []
  ).map(p => String(p))

  const r: Record<string, unknown> = {}

  // Interface selection. Mutual exclusion is enforced by yargs .conflicts(),
  // so at most one of these will be true.
  const activeInterface = INTERFACE_FLAGS.find(f => values[f])
  if (activeInterface) setPath(r, ['app', 'interface'], activeInterface)

  // Apply declarative flag rules
  for (const [flag, rule] of Object.entries(FLAG_RULES)) {
    const val = values[flag]
    if (val === undefined) continue
    if (Array.isArray(val)) {
      // Array-typed flags (e.g. --skill-dir) write the whole array at once.
      setPath(r, rule.path, val)
    } else {
      applyRule(r, rule, val as string | boolean)
    }
  }

  // --openai-base-url and --openai-api-key apply to both openai and
  // openai-completions providers (they share credentials).
  if (typeof values['openai-base-url'] === 'string') {
    setPath(r, ['app', 'providers', 'openai-completions', 'baseURL'], values['openai-base-url'])
  }
  if (typeof values['openai-api-key'] === 'string') {
    setPath(r, ['app', 'providers', 'openai-completions', 'apiKey'], values['openai-api-key'])
  }

  // --memories, --list-memories, and --forget all imply --memory
  if (values['memory'] || values['list-memories'] || values['memories'] || values['forget']) {
    setPath(r, ['agent', 'memory', 'enabled'], true)
  }

  return {
    config: r as Partial<RaConfig>,
    meta: {
      help:           Boolean(values.help),
      version:        Boolean(values.version),
      showContext:    Boolean(values['show-context']),
      showConfig:     Boolean(values['show-config']),
      runImmediately: Boolean(values['run-immediately']),
      listMemories:   Boolean(values['list-memories']),
      memories:       values.memories as string | undefined,
      forget:         values.forget as string | undefined,
      files:          (values.file as string[] | undefined) ?? [],
      prompt:         positionals.length > 0 ? positionals.join(' ') : undefined,
      resume,
      configPath:     values.config as string | undefined,
      exec:           values.exec as string | undefined,
      recipeName:     values.recipe as string | undefined,
    },
  }
}

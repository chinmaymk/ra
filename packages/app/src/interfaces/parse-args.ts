import yargs from 'yargs'
import { setPath, applyRule, type CoercionRule } from '../utils/config-helpers'
import type { RaConfig } from '../config/types'

export type SubCommand =
  | { kind: 'skill' | 'recipe'; action: 'install' | 'remove' | 'list'; args: string[] }
  | { kind: 'login'; action: string; args: string[] }

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

// Maps CLI flag names to config paths with type coercion
const FLAG_RULES: Record<string, CoercionRule> = {
  // ── agent section ────────────────────────────────────────────────────
  provider:                      { type: 'string', path: ['agent', 'provider'] },
  model:                         { type: 'string', path: ['agent', 'model'] },
  'system-prompt':               { type: 'string', path: ['agent', 'systemPrompt'] },
  'max-iterations':              { type: 'int',    path: ['agent', 'maxIterations'] },
  thinking:                      { type: 'string', path: ['agent', 'thinking'] },
  'thinking-budget-cap':         { type: 'int',    path: ['agent', 'thinkingBudgetCap'] },
  'tool-timeout':                { type: 'int',    path: ['agent', 'toolTimeout'] },
  'max-tool-response-size':      { type: 'int',    path: ['agent', 'tools', 'maxResponseSize'] },
  'tools-builtin':               { type: 'bool',   path: ['agent', 'tools', 'builtin'], value: true },
  // ── app section ──────────────────────────────────────────────────────
  'anthropic-base-url':          { type: 'string', path: ['app', 'providers', 'anthropic', 'baseURL'] },
  'openai-base-url':             { type: 'string', path: ['app', 'providers', 'openai', 'baseURL'] },
  'google-base-url':             { type: 'string', path: ['app', 'providers', 'google', 'baseURL'] },
  'ollama-host':                 { type: 'string', path: ['app', 'providers', 'ollama', 'host'] },
  'bedrock-base-url':            { type: 'string', path: ['app', 'providers', 'bedrock', 'baseURL'] },
  'azure-endpoint':              { type: 'string', path: ['app', 'providers', 'azure', 'endpoint'] },
  'azure-deployment':            { type: 'string', path: ['app', 'providers', 'azure', 'deployment'] },
  'http-port':                   { type: 'int',    path: ['app', 'http', 'port'] },
  'http-token':                  { type: 'string', path: ['app', 'http', 'token'] },
  'inspector-port':              { type: 'int',    path: ['app', 'inspector', 'port'] },
  'mcp-server-enabled':          { type: 'bool',   path: ['app', 'raMcpServer', 'enabled'], value: true },
  'mcp-server-port':             { type: 'int',    path: ['app', 'raMcpServer', 'port'] },
  'mcp-server-tool-name':        { type: 'string', path: ['app', 'raMcpServer', 'tool', 'name'] },
  'mcp-server-tool-description': { type: 'string', path: ['app', 'raMcpServer', 'tool', 'description'] },
  'data-dir':                    { type: 'string', path: ['app', 'dataDir'] },
  'storage-max-sessions':        { type: 'int',    path: ['app', 'storage', 'maxSessions'] },
  'storage-ttl-days':            { type: 'int',    path: ['app', 'storage', 'ttlDays'] },
  'skill-dir':                   { type: 'string', path: ['agent', 'skillDirs'] },
}

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

  return null
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

/**
 * Build a yargs parser with all known options. We declare numeric flags as
 * strings so that invalid input can be silently ignored downstream by
 * `safeParseInt` (matches the historical behaviour the test suite encodes).
 */
function buildYargs(args: string[]) {
  return yargs(args)
    .help(false)
    .version(false)
    .exitProcess(false)
    .parserConfiguration({
      'camel-case-expansion': false,    // keep --skill-dir, don't also create skillDir
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
    .option('help',                          { type: 'boolean', alias: 'h', default: false })
    .option('version',                       { type: 'boolean', alias: 'v', default: false })
    .option('show-context',                  { type: 'boolean', default: false })
    .option('show-config',                   { type: 'boolean', default: false })
    // Interface selection
    .option('http',                          { type: 'boolean' })
    .option('cli',                           { type: 'boolean' })
    .option('repl',                          { type: 'boolean' })
    .option('mcp',                           { type: 'boolean' })
    .option('mcp-stdio',                     { type: 'boolean' })
    .option('inspector',                     { type: 'boolean' })
    .option('cron',                          { type: 'boolean' })
    .option('run-immediately',               { type: 'boolean', default: false })
    // Agent config (numerics declared as strings; coerced via FLAG_RULES)
    .option('provider',                      { type: 'string' })
    .option('model',                         { type: 'string' })
    .option('system-prompt',                 { type: 'string' })
    .option('max-iterations',                { type: 'string' })
    .option('thinking',                      { type: 'string' })
    .option('thinking-budget-cap',           { type: 'string' })
    .option('tool-timeout',                  { type: 'string' })
    .option('max-tool-response-size',        { type: 'string' })
    .option('tools-builtin',                 { type: 'boolean' })
    // HTTP server
    .option('http-port',                     { type: 'string' })
    .option('http-token',                    { type: 'string' })
    // Inspector
    .option('inspector-port',                { type: 'string' })
    // MCP server
    .option('mcp-server-enabled',            { type: 'boolean' })
    .option('mcp-server-port',               { type: 'string' })
    .option('mcp-server-tool-name',          { type: 'string' })
    .option('mcp-server-tool-description',   { type: 'string' })
    // Memory
    .option('memory',                        { type: 'boolean' })
    .option('list-memories',                 { type: 'boolean', default: false })
    .option('memories',                      { type: 'string' })
    .option('forget',                        { type: 'string' })
    // Data & storage
    .option('data-dir',                      { type: 'string' })
    .option('storage-max-sessions',          { type: 'string' })
    .option('storage-ttl-days',              { type: 'string' })
    // Skills & recipes
    .option('skill-dir',                     { type: 'string', array: true })
    .option('recipe',                        { type: 'string' })
    // Provider connection options
    .option('anthropic-base-url',            { type: 'string' })
    .option('openai-base-url',               { type: 'string' })
    .option('google-base-url',               { type: 'string' })
    .option('ollama-host',                   { type: 'string' })
    .option('bedrock-base-url',              { type: 'string' })
    .option('azure-endpoint',                { type: 'string' })
    .option('azure-deployment',              { type: 'string' })
    .fail((msg, err) => {
      // Swallow yargs errors silently — historically the parser used
      // `strict: false` and never errored on unknown flags. Surfacing
      // these would change behaviour for callers like `ra login` that
      // pass through provider-specific flags.
      if (err) throw err
      void msg
    })
}

export function parseArgs(argv: string[]): ParsedArgs {
  const userArgs = stripArgvPrefix(argv)

  const sub = parseSubcommand(userArgs)
  if (sub) return sub

  const { rest, resume } = extractResume(userArgs)

  const values = buildYargs(rest).parseSync() as Record<string, unknown>
  const positionals = ((values._ as unknown[]) ?? []).map(p => String(p))

  const r: Record<string, unknown> = {}

  // Interface selection — first match wins. Order matters: mcp-stdio before mcp.
  const interfaceFlags = ['mcp-stdio', 'mcp', 'http', 'inspector', 'cron', 'repl', 'cli'] as const
  for (const flag of interfaceFlags) {
    if (values[flag]) { setPath(r, ['app', 'interface'], flag); break }
  }

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

  // --openai-base-url applies to both openai and openai-completions providers
  if (typeof values['openai-base-url'] === 'string') {
    setPath(r, ['app', 'providers', 'openai-completions', 'baseURL'], values['openai-base-url'])
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

/**
 * Single source of truth for every CLI option, env-var binding, and config
 * path mapping. Both the CLI parser (`interfaces/parse-args.ts`) and
 * `loadConfig` derive their behaviour from this one table.
 *
 * Each {@link OptionDef} ties together:
 *   - the yargs option declaration (type, choices, alias, hidden, array)
 *   - the nested config path it writes into (`path`)
 *   - the standard environment variable that supplies its default (`env`)
 *   - the dual config path for openai/openai-completions credential sharing
 *   - whether it's a meta-only flag (no config path; lands in ParsedArgsMeta)
 *
 * Adding a new flag means adding one entry to {@link OPTIONS} — no changes
 * to parse-args, schema duplication, or env mapping tables required.
 */

import { setPath, safeParseInt } from '../utils/config-helpers'

export const PROVIDERS = [
  'anthropic', 'openai', 'openai-completions', 'google',
  'ollama', 'bedrock', 'azure', 'codex', 'anthropic-agents-sdk',
] as const
export type Provider = typeof PROVIDERS[number]

export const INTERFACE_FLAGS = ['mcp-stdio', 'mcp', 'http', 'inspector', 'cron', 'repl', 'cli'] as const
export type InterfaceFlag = typeof INTERFACE_FLAGS[number]

export const THINKING_LEVELS = ['low', 'medium', 'high'] as const

/**
 * Flags that are only meaningful when --provider is one of these values.
 * Validated only when --provider is explicitly given on the CLI; otherwise
 * the flag passes through (a config file or recipe may set the provider).
 */
export const PROVIDER_SCOPED: Readonly<Record<string, readonly Provider[]>> = {
  'anthropic-base-url': ['anthropic'],
  'openai-base-url':    ['openai', 'openai-completions'],
  'google-base-url':    ['google'],
  'ollama-host':        ['ollama'],
  'bedrock-base-url':   ['bedrock'],
  'azure-endpoint':     ['azure'],
  'azure-deployment':   ['azure'],
}

/**
 * Flags that are only meaningful when one of the listed interface flags is
 * active. Validated only when an interface flag is explicitly given on the
 * CLI; otherwise the flag passes through (config may set the interface).
 */
export const INTERFACE_SCOPED: Readonly<Record<string, readonly InterfaceFlag[]>> = {
  'http-port':        ['http'],
  'http-token':       ['http'],
  'inspector-port':   ['inspector'],
  'run-immediately':  ['cron'],
}

/**
 * Meta-flag keys (`meta` field of OptionDef). When the field is set, the
 * flag's parsed value is copied into `ParsedArgsMeta[<this key>]` instead
 * of being written into the merged config.
 */
export type MetaKey =
  | 'help'
  | 'version'
  | 'showContext'
  | 'showConfig'
  | 'runImmediately'
  | 'listMemories'
  | 'memories'
  | 'forget'
  | 'files'
  | 'configPath'
  | 'exec'
  | 'recipeName'

export interface OptionDef {
  /** Dashed flag name as it appears on the CLI (also the yargs option key). */
  readonly name: string
  readonly type: 'string' | 'boolean'
  /** Post-process the parsed string value as an integer (silently dropped on NaN). */
  readonly coerce?: 'int'
  /** Yargs `.choices()` set — invalid values fail at parse time. */
  readonly choices?: readonly string[]
  /** Repeatable flag (`--file a --file b`). */
  readonly array?: boolean
  readonly alias?: string
  /** Hidden from --help output (still parseable). */
  readonly hidden?: boolean
  /** Nested config path the value writes into. Absent for meta-only flags. */
  readonly path?: readonly string[]
  /** Mirror the value to a second path (used for openai → openai-completions). */
  readonly dual?: readonly string[]
  /** Standard env var that supplies the default if no CLI flag was passed. */
  readonly env?: string
  /** Meta-only flag: parsed value lands in ParsedArgsMeta[meta] instead of config. */
  readonly meta?: MetaKey
  /** Boolean flags whose presence writes a fixed value (vs. literal `true`). */
  readonly boolValue?: unknown
}

export const OPTIONS: readonly OptionDef[] = [
  // Meta flags (no config path)
  { name: 'help',          type: 'boolean', alias: 'h', meta: 'help' },
  { name: 'version',       type: 'boolean', alias: 'v', meta: 'version' },
  { name: 'show-context',  type: 'boolean', meta: 'showContext' },
  { name: 'show-config',   type: 'boolean', meta: 'showConfig' },
  { name: 'config',        type: 'string',  meta: 'configPath' },
  { name: 'exec',          type: 'string',  meta: 'exec' },
  { name: 'file',          type: 'string',  array: true, meta: 'files' },
  { name: 'recipe',        type: 'string',  meta: 'recipeName' },

  // Interface selection (mutually exclusive — see .conflicts in parse-args)
  { name: 'http',           type: 'boolean' },
  { name: 'cli',            type: 'boolean' },
  { name: 'repl',           type: 'boolean' },
  { name: 'mcp',            type: 'boolean' },
  { name: 'mcp-stdio',      type: 'boolean' },
  { name: 'inspector',      type: 'boolean' },
  { name: 'cron',           type: 'boolean' },
  { name: 'run-immediately', type: 'boolean', meta: 'runImmediately' },

  // Agent
  { name: 'provider',                type: 'string', choices: PROVIDERS,       path: ['agent', 'provider'] },
  { name: 'model',                   type: 'string',                            path: ['agent', 'model'] },
  { name: 'system-prompt',           type: 'string',                            path: ['agent', 'systemPrompt'] },
  { name: 'max-iterations',          type: 'string', coerce: 'int',             path: ['agent', 'maxIterations'] },
  { name: 'thinking',                type: 'string', choices: THINKING_LEVELS,  path: ['agent', 'thinking'] },
  { name: 'thinking-budget-cap',     type: 'string', coerce: 'int',             path: ['agent', 'thinkingBudgetCap'] },
  { name: 'tool-timeout',            type: 'string', coerce: 'int',             path: ['agent', 'toolTimeout'] },
  { name: 'max-tool-response-size',  type: 'string', coerce: 'int',             path: ['agent', 'tools', 'maxResponseSize'] },
  { name: 'tools-builtin',           type: 'boolean', boolValue: true,          path: ['agent', 'tools', 'builtin'] },
  { name: 'skill-dir',               type: 'string',  array: true,              path: ['agent', 'skillDirs'] },

  // Memory
  { name: 'memory',         type: 'boolean' },
  { name: 'list-memories',  type: 'boolean', meta: 'listMemories' },
  { name: 'memories',       type: 'string',  meta: 'memories' },
  { name: 'forget',         type: 'string',  meta: 'forget' },

  // HTTP / Inspector
  { name: 'http-port',      type: 'string', coerce: 'int', path: ['app', 'http', 'port'] },
  { name: 'http-token',     type: 'string',                 path: ['app', 'http', 'token'] },
  { name: 'inspector-port', type: 'string', coerce: 'int', path: ['app', 'inspector', 'port'] },

  // Storage
  { name: 'data-dir',             type: 'string',                 path: ['app', 'dataDir'] },
  { name: 'storage-max-sessions', type: 'string', coerce: 'int', path: ['app', 'storage', 'maxSessions'] },
  { name: 'storage-ttl-days',     type: 'string', coerce: 'int', path: ['app', 'storage', 'ttlDays'] },

  // Ra MCP server (independent of interface — can run alongside any interface)
  { name: 'mcp-server-enabled',          type: 'boolean', boolValue: true,    path: ['app', 'raMcpServer', 'enabled'] },
  { name: 'mcp-server-port',             type: 'string',  coerce: 'int',      path: ['app', 'raMcpServer', 'port'] },
  { name: 'mcp-server-tool-name',        type: 'string',                       path: ['app', 'raMcpServer', 'tool', 'name'] },
  { name: 'mcp-server-tool-description', type: 'string',                       path: ['app', 'raMcpServer', 'tool', 'description'] },

  // Provider connection options (env defaults match the SDKs' own conventions)
  { name: 'anthropic-base-url', type: 'string', env: 'ANTHROPIC_BASE_URL', path: ['app', 'providers', 'anthropic', 'baseURL'] },
  { name: 'openai-base-url',    type: 'string', env: 'OPENAI_BASE_URL',    path: ['app', 'providers', 'openai', 'baseURL'],
    dual: ['app', 'providers', 'openai-completions', 'baseURL'] },
  { name: 'google-base-url',    type: 'string', env: 'GOOGLE_BASE_URL',    path: ['app', 'providers', 'google', 'baseURL'] },
  { name: 'ollama-host',        type: 'string', env: 'OLLAMA_HOST',        path: ['app', 'providers', 'ollama', 'host'] },
  { name: 'bedrock-base-url',   type: 'string',                            path: ['app', 'providers', 'bedrock', 'baseURL'] },
  { name: 'azure-endpoint',     type: 'string', env: 'AZURE_OPENAI_ENDPOINT',  path: ['app', 'providers', 'azure', 'endpoint'] },
  { name: 'azure-deployment',   type: 'string', env: 'AZURE_OPENAI_DEPLOYMENT', path: ['app', 'providers', 'azure', 'deployment'] },

  // Hidden credential flags. Marked hidden so users don't put raw API keys
  // into shell history; declared so the secrets store and standard env vars
  // can flow through the same nested config paths and validation pipeline.
  { name: 'anthropic-api-key',     type: 'string', hidden: true, env: 'ANTHROPIC_API_KEY',     path: ['app', 'providers', 'anthropic', 'apiKey'] },
  { name: 'openai-api-key',        type: 'string', hidden: true, env: 'OPENAI_API_KEY',        path: ['app', 'providers', 'openai', 'apiKey'],
    dual: ['app', 'providers', 'openai-completions', 'apiKey'] },
  { name: 'google-api-key',        type: 'string', hidden: true, env: 'GOOGLE_API_KEY',        path: ['app', 'providers', 'google', 'apiKey'] },
  { name: 'azure-api-key',         type: 'string', hidden: true, env: 'AZURE_OPENAI_API_KEY',  path: ['app', 'providers', 'azure', 'apiKey'] },
  { name: 'aws-access-key-id',     type: 'string', hidden: true, env: 'AWS_ACCESS_KEY_ID',     path: ['app', 'providers', 'bedrock', 'accessKeyId'] },
  { name: 'aws-secret-access-key', type: 'string', hidden: true, env: 'AWS_SECRET_ACCESS_KEY', path: ['app', 'providers', 'bedrock', 'secretAccessKey'] },
  { name: 'aws-session-token',     type: 'string', hidden: true, env: 'AWS_SESSION_TOKEN',     path: ['app', 'providers', 'bedrock', 'sessionToken'] },
  { name: 'aws-region',            type: 'string', hidden: true, env: 'AWS_REGION',            path: ['app', 'providers', 'bedrock', 'region'] },
  { name: 'bedrock-api-key',       type: 'string', hidden: true, env: 'AWS_BEDROCK_API_KEY',   path: ['app', 'providers', 'bedrock', 'apiKey'] },
  { name: 'codex-access-token',    type: 'string', hidden: true, env: 'CODEX_ACCESS_TOKEN',    path: ['app', 'providers', 'codex', 'accessToken'] },

  // Acknowledge env-only knobs so yargs `.env('RA')` doesn't reject them
  // under strict mode. The actual lookups happen elsewhere:
  //   - secrets path → `secrets/store.ts` via `getSecretsPath()`
  //   - profile     → `extractProfile()` (pre-stripped from args)
  { name: 'secrets-path', type: 'string', hidden: true },
  { name: 'profile',      type: 'string', hidden: true },
] as const

/** O(1) lookup table built once at module load. */
export const OPTIONS_BY_NAME: ReadonlyMap<string, OptionDef> =
  new Map(OPTIONS.map(o => [o.name, o]))

/**
 * Build a nested config layer populated only from standard environment
 * variables (and the secrets store via `buildMergedEnv`). Used by
 * `loadConfig` so it works correctly when called directly without going
 * through `parseArgs`. Same OPTIONS table the CLI parser uses, so the
 * env→config mapping never drifts.
 */
export function buildStandardEnvLayer(env: Record<string, string | undefined>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const opt of OPTIONS) {
    if (!opt.env || !opt.path) continue
    const v = env[opt.env]
    if (!v || v.length === 0) continue
    setPath(result, opt.path as string[], v)
    if (opt.dual) setPath(result, opt.dual as string[], v)
  }
  return result
}

/**
 * Coerce a parsed yargs value to the form that should be written into the
 * config object. Returns `undefined` if the option should NOT be written
 * (e.g. boolean false, NaN integer).
 */
export function coerceOptionValue(opt: OptionDef, val: unknown): unknown {
  if (val === undefined) return undefined
  if (Array.isArray(val)) return val
  if (opt.boolValue !== undefined) return val ? opt.boolValue : undefined
  if (opt.coerce === 'int') return safeParseInt(val as string)
  return val
}

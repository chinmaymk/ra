import { parseArgs as utilParseArgs } from 'util'
import { setPath, safeParseInt } from '../utils/config-helpers'
import type { RaConfig } from '../config/types'

export interface SkillCommand {
  action: 'install' | 'remove' | 'list'
  args: string[]
}

export interface ParsedArgsMeta {
  help: boolean
  version: boolean
  files: string[]
  skills: string[]
  prompt?: string
  resume?: string
  configPath?: string
  exec?: string
  showContext: boolean
  showConfig: boolean
  listMemories: boolean
  memories?: string
  forget?: string
  skillCommand?: SkillCommand
}

export interface ParsedArgs {
  config: Partial<RaConfig>
  meta: ParsedArgsMeta
}

type FlagRule =
  | { type: 'string'; path: string[] }
  | { type: 'int'; path: string[] }
  | { type: 'bool'; path: string[]; value: unknown }

// Maps CLI flag names to config paths with type coercion
const FLAG_RULES: Record<string, FlagRule> = {
  provider:                      { type: 'string', path: ['provider'] },
  model:                         { type: 'string', path: ['model'] },
  'system-prompt':               { type: 'string', path: ['systemPrompt'] },
  'max-iterations':              { type: 'int',    path: ['maxIterations'] },
  thinking:                      { type: 'string', path: ['thinking'] },
  'tool-timeout':                { type: 'int',    path: ['toolTimeout'] },
  'tools-builtin':               { type: 'bool',   path: ['tools', 'builtin'], value: true },
  'http-port':                   { type: 'int',    path: ['http', 'port'] },
  'http-token':                  { type: 'string', path: ['http', 'token'] },
  'mcp-server-enabled':          { type: 'bool',   path: ['mcp', 'server', 'enabled'], value: true },
  'mcp-server-port':             { type: 'int',    path: ['mcp', 'server', 'port'] },
  'mcp-server-tool-name':        { type: 'string', path: ['mcp', 'server', 'tool', 'name'] },
  'mcp-server-tool-description': { type: 'string', path: ['mcp', 'server', 'tool', 'description'] },
  'data-dir':                    { type: 'string', path: ['dataDir'] },
  'storage-max-sessions':        { type: 'int',    path: ['storage', 'maxSessions'] },
  'storage-ttl-days':            { type: 'int',    path: ['storage', 'ttlDays'] },
  'skill-dir':                   { type: 'string', path: ['skillDirs'] },
  'anthropic-base-url':          { type: 'string', path: ['providers', 'anthropic', 'baseURL'] },
  'openai-base-url':             { type: 'string', path: ['providers', 'openai', 'baseURL'] },
  'google-base-url':             { type: 'string', path: ['providers', 'google', 'baseURL'] },
  'ollama-host':                 { type: 'string', path: ['providers', 'ollama', 'host'] },
  'azure-endpoint':              { type: 'string', path: ['providers', 'azure', 'endpoint'] },
  'azure-deployment':            { type: 'string', path: ['providers', 'azure', 'deployment'] },
}

export function parseArgs(argv: string[]): ParsedArgs {
  const isScriptPath = argv[1] !== undefined && (
    /\.(ts|js|mjs|cjs)$/.test(argv[1]) || argv[1].startsWith('/$bunfs/')
  )
  const userArgs = argv.slice(isScriptPath ? 2 : 1)

  // Check for skill subcommand: ra skill install|remove|list [args...]
  if (userArgs[0] === 'skill' && userArgs[1] && ['install', 'remove', 'list'].includes(userArgs[1])) {
    const action = userArgs[1] as 'install' | 'remove' | 'list'
    const subArgs = userArgs.slice(2)
    return {
      config: {},
      meta: {
        help: false,
        version: false,
        showContext: false,
        showConfig: false,
        listMemories: false,
        files: [],
        skills: [],
        skillCommand: { action, args: subArgs },
      },
    }
  }

  const { values, positionals } = utilParseArgs({
    args: userArgs,
    options: {
      // Meta (not mapped to RaConfig)
      exec:                          { type: 'string' },
      config:                        { type: 'string' },
      skill:                         { type: 'string', multiple: true },
      file:                          { type: 'string', multiple: true },
      resume:                        { type: 'string' },
      help:                          { type: 'boolean', short: 'h' },
      version:                       { type: 'boolean', short: 'v' },
      'show-context':                { type: 'boolean' },
      'show-config':              { type: 'boolean' },
      // Interface selection → config.interface
      http:                          { type: 'boolean' },
      cli:                           { type: 'boolean' },
      repl:                          { type: 'boolean' },
      mcp:                           { type: 'boolean' },
      'mcp-stdio':                   { type: 'boolean' },
      // Top-level config
      provider:                      { type: 'string' },
      model:                         { type: 'string' },
      'system-prompt':               { type: 'string' },
      'max-iterations':              { type: 'string' },
      'thinking':                    { type: 'string' },
      'tool-timeout':                { type: 'string' },
      'tools-builtin':               { type: 'boolean' },
      // HTTP server
      'http-port':                   { type: 'string' },
      'http-token':                  { type: 'string' },
      // MCP server
      'mcp-server-enabled':          { type: 'boolean' },
      'mcp-server-port':             { type: 'string' },
      'mcp-server-tool-name':        { type: 'string' },
      'mcp-server-tool-description': { type: 'string' },
      // Memory
      'memory':                      { type: 'boolean' },
      'list-memories':               { type: 'boolean' },
      'memories':                    { type: 'string' },
      'forget':                      { type: 'string' },
      // Data directory & storage
      'data-dir':                    { type: 'string' },
      'storage-max-sessions':        { type: 'string' },
      'storage-ttl-days':            { type: 'string' },
      // Skills
      'skill-dir':                   { type: 'string', multiple: true },
      // Provider connection options (non-sensitive)
      'anthropic-base-url':          { type: 'string' },
      'openai-base-url':             { type: 'string' },
      'google-base-url':             { type: 'string' },
      'ollama-host':                 { type: 'string' },
      'azure-endpoint':              { type: 'string' },
      'azure-deployment':            { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  })

  const r: Record<string, unknown> = {}

  // Interface selection
  if (values['mcp-stdio'])    setPath(r, ['interface'], 'mcp-stdio')
  else if (values.mcp)       setPath(r, ['interface'], 'mcp')
  else if (values.http) setPath(r, ['interface'], 'http')
  else if (values.repl) setPath(r, ['interface'], 'repl')
  else if (values.cli)  setPath(r, ['interface'], 'cli')

  // Apply declarative flag rules
  for (const [flag, rule] of Object.entries(FLAG_RULES)) {
    const val = values[flag]
    if (val === undefined) continue
    if (rule.type === 'string') setPath(r, rule.path, val)
    else if (rule.type === 'int') { const n = safeParseInt(val as string); if (n !== undefined) setPath(r, rule.path, n) }
    else if (rule.type === 'bool') setPath(r, rule.path, rule.value)
  }

  // Memory — --memories, --list-memories, and --forget imply --memory
  if (values['memory'] || values['list-memories'] || values['memories'] || values['forget']) setPath(r, ['memory', 'enabled'], true)

  return {
    config: r as Partial<RaConfig>,
    meta: {
      help:         (values.help as boolean | undefined) ?? false,
      version:      (values.version as boolean | undefined) ?? false,
      showContext:   (values['show-context'] as boolean | undefined) ?? false,
      showConfig:  (values['show-config'] as boolean | undefined) ?? false,
      listMemories:  (values['list-memories'] as boolean | undefined) ?? false,
      memories:      values.memories as string | undefined,
      forget:        values.forget as string | undefined,
      files:      (values.file as string[] | undefined) ?? [],
      skills:     (values.skill as string[] | undefined) ?? [],
      prompt:     positionals.join(' ') || undefined,
      resume:     values.resume as string | undefined,
      configPath: values.config as string | undefined,
      exec:       values.exec as string | undefined,
    },
  }
}

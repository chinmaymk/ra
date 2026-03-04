import { parseArgs as utilParseArgs } from 'util'

export interface ParsedArgs {
  provider?: string
  model?: string
  config?: string
  skills: string[]
  files: string[]
  systemPrompt?: string
  resume?: string
  http: boolean
  cli: boolean
  repl: boolean
  mcp: boolean
  prompt?: string
  help: boolean
}

export function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] is always the runtime (bun or compiled binary path)
  // argv[1] is the script path in dev mode, absent in compiled binary mode
  const isDevMode = argv[1] !== undefined && /\.(ts|js|mjs|cjs)$/.test(argv[1])
  const userArgs = argv.slice(isDevMode ? 2 : 1)

  const { values, positionals } = utilParseArgs({
    args: userArgs,
    options: {
      provider:        { type: 'string' },
      model:           { type: 'string' },
      config:          { type: 'string' },
      skill:           { type: 'string', multiple: true },
      file:            { type: 'string', multiple: true },
      'system-prompt': { type: 'string' },
      resume:          { type: 'string' },
      help:            { type: 'boolean', short: 'h' },
      http:            { type: 'boolean' },
      cli:             { type: 'boolean' },
      repl:            { type: 'boolean' },
      mcp:             { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  })

  return {
    provider:     values.provider as string | undefined,
    model:        values.model as string | undefined,
    config:       values.config as string | undefined,
    skills:       (values.skill as string[] | undefined) ?? [],
    files:        (values.file as string[] | undefined) ?? [],
    systemPrompt: values['system-prompt'] as string | undefined,
    resume:       values.resume as string | undefined,
    http:         (values.http as boolean | undefined) ?? false,
    cli:          (values.cli as boolean | undefined) ?? false,
    repl:         (values.repl as boolean | undefined) ?? false,
    mcp:          (values.mcp as boolean | undefined) ?? false,
    prompt:       positionals.join(' ') || undefined,
    help:         (values.help as boolean | undefined) ?? false,
  }
}

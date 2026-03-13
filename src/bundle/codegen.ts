/**
 * Generates a self-contained TypeScript entry point for a bundled ra binary.
 *
 * The generated file:
 *   - Imports ra core modules directly (agent loop, providers, tools, etc.)
 *   - Embeds config as a literal object
 *   - Embeds skills as string literals
 *   - Imports middleware files directly (bundled at compile time)
 *   - Skips all runtime filesystem discovery
 */
import type { RaConfig } from '../config/types'
import type { EmbeddedSkill, MiddlewareImport } from './index'

export interface CodegenOptions {
  config: RaConfig
  embeddedSkills: EmbeddedSkill[]
  middlewareImports: MiddlewareImport[]
  raSourceDir: string
  binaryName: string
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
}

function serializeConfig(config: RaConfig): string {
  // Strip non-serializable fields and middleware (handled separately)
  const serializable: Record<string, unknown> = { ...config }
  delete serializable.middleware
  delete serializable.configDir
  delete serializable.compaction  // rebuilt at runtime

  // Remove functions and undefined values
  return JSON.stringify(serializable, (_, v) => {
    if (typeof v === 'function') return undefined
    return v
  }, 2)
}

export function generateEntryPoint(opts: CodegenOptions): string {
  const { config, embeddedSkills, middlewareImports, raSourceDir, binaryName } = opts

  const lines: string[] = []

  lines.push('#!/usr/bin/env bun')
  lines.push(`// Auto-generated bundled entry point for "${binaryName}"`)
  lines.push(`// Generated at ${new Date().toISOString()}`)
  lines.push(`// This binary is self-contained and non-extensible.`)
  lines.push('')

  // ── Imports from ra source ─────────────────────────────────────
  lines.push(`import { bootstrap } from '${raSourceDir}/bootstrap'`)
  lines.push(`import { loadConfig } from '${raSourceDir}/config'`)
  lines.push(`import { parseArgs } from '${raSourceDir}/interfaces/parse-args'`)
  lines.push(`import { errorMessage } from '${raSourceDir}/utils/errors'`)
  lines.push(`import { runCli } from '${raSourceDir}/interfaces/cli'`)
  lines.push(`import { Repl } from '${raSourceDir}/interfaces/repl'`)
  lines.push(`import { HttpServer } from '${raSourceDir}/interfaces/http'`)
  lines.push(`import { AgentLoop } from '${raSourceDir}/agent/loop'`)
  lines.push(`import { startMcpStdio, startMcpHttp } from '${raSourceDir}/mcp/server'`)
  lines.push(`import { serializeContent } from '${raSourceDir}/providers/utils'`)
  lines.push(`import type { IMessage } from '${raSourceDir}/providers/types'`)
  lines.push('')

  // ── Middleware imports ──────────────────────────────────────────
  const mwVarNames: Map<string, string[]> = new Map()
  let mwIdx = 0
  for (const mw of middlewareImports) {
    if (mw.type === 'file' && mw.path) {
      const varName = `__mw${mwIdx++}`
      lines.push(`import ${varName} from '${mw.path}'`)
      const hooks = mwVarNames.get(mw.hook) ?? []
      hooks.push(varName)
      mwVarNames.set(mw.hook, hooks)
    }
  }
  lines.push('')

  // ── Embedded config ────────────────────────────────────────────
  lines.push(`const BUNDLED_CONFIG = ${serializeConfig(config)}`)
  lines.push('')

  // ── Embedded skills ────────────────────────────────────────────
  lines.push('const BUNDLED_SKILLS = new Map()')
  for (const skill of embeddedSkills) {
    const refs: Record<string, string> = {}
    for (const [path, content] of Object.entries(skill.references)) {
      refs[path] = content
    }
    lines.push(`BUNDLED_SKILLS.set(${JSON.stringify(skill.name)}, {`)
    lines.push(`  metadata: ${JSON.stringify(skill.metadata)},`)
    lines.push(`  body: \`${escapeString(skill.body)}\`,`)
    lines.push(`  dir: 'bundled:${skill.name}',`)
    lines.push(`  scripts: ${JSON.stringify(skill.scripts)},`)
    lines.push(`  references: ${JSON.stringify(skill.references ? Object.keys(skill.references) : [])},`)
    lines.push(`  assets: ${JSON.stringify(skill.assets)},`)
    lines.push(`  _embeddedReferences: ${JSON.stringify(refs)},`)
    lines.push('})')
  }
  lines.push('')

  // ── Bundled middleware object ───────────────────────────────────
  lines.push('const BUNDLED_MIDDLEWARE = {')
  const allHooks = new Set<string>()
  for (const mw of middlewareImports) allHooks.add(mw.hook)
  for (const hook of allHooks) {
    const parts: string[] = []
    for (const mw of middlewareImports.filter(m => m.hook === hook)) {
      if (mw.type === 'file') {
        const hookVars = mwVarNames.get(hook) ?? []
        if (hookVars.length > 0) parts.push(hookVars.shift()!)
      } else if (mw.type === 'inline' && mw.expression) {
        parts.push(`(${mw.expression})`)
      }
    }
    lines.push(`  ${hook}: [${parts.join(', ')}],`)
  }
  lines.push('}')
  lines.push('')

  // ── Helpers (from src/index.ts) ────────────────────────────────
  lines.push(`
async function readStdin() {
  if (process.stdin.isTTY) return undefined
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf-8').trim()
  return text || undefined
}

function onSignals(fn) {
  const handler = async () => { await fn(); process.exit(0) }
  process.on('SIGINT', handler)
  process.on('SIGTERM', handler)
  return { remove: () => { process.off('SIGINT', handler); process.off('SIGTERM', handler) } }
}
`)

  // ── Main function ──────────────────────────────────────────────
  lines.push(`async function main() {
  const parsed = parseArgs(process.argv)

  if (parsed.meta.version) {
    console.log('${binaryName} (bundled ra agent)')
    process.exit(0)
  }
  if (parsed.meta.help) {
    console.log(\`${binaryName} — bundled ra agent

USAGE
  ${binaryName} [options] [prompt]

OPTIONS
  --provider <name>       Override provider
  --model <name>          Override model
  --cli                   Oneshot mode (default when prompt given)
  --repl                  Interactive REPL mode
  --http                  Start HTTP API server
  --mcp                   Start MCP HTTP server
  --mcp-stdio             Start MCP stdio server
  --version, -v           Print version
  --help, -h              Print this help

ENV VARS
  RA_PROVIDER, RA_MODEL, RA_ANTHROPIC_API_KEY, RA_OPENAI_API_KEY, etc.\`)
    process.exit(0)
  }

  // Read piped stdin
  const isNonCliInterface = parsed.config.interface && parsed.config.interface !== 'cli'
  if (!isNonCliInterface) {
    const stdinContent = await readStdin()
    if (stdinContent) {
      parsed.meta.prompt = parsed.meta.prompt
        ? parsed.meta.prompt + '\\n\\n' + stdinContent
        : stdinContent
      parsed.config.interface = 'cli'
    }
  }

  // Load config starting from bundled defaults, then overlay env + CLI flags
  const config = await loadConfig({
    cwd: process.cwd(),
    cliArgs: parsed.config,
    env: process.env,
  })

  // Overlay bundled config values onto loaded config (bundled takes precedence over file discovery)
  const bundled = BUNDLED_CONFIG
  for (const key of Object.keys(bundled)) {
    if (key === 'providers') continue // keep env-var-resolved provider config
    if (parsed.config[key] !== undefined) continue // CLI flags take precedence
    config[key] = bundled[key]
  }

  // Force-merge provider settings from bundled config (except API keys, which come from env)
  if (bundled.providers) {
    for (const [prov, provConfig] of Object.entries(bundled.providers)) {
      if (!provConfig) continue
      for (const [k, v] of Object.entries(provConfig)) {
        if (k.toLowerCase().includes('key') || k.toLowerCase().includes('secret')) continue
        if (!config.providers[prov]) config.providers[prov] = {}
        if (config.providers[prov][k] === undefined) config.providers[prov][k] = v
      }
    }
  }

  // Inject bundled middleware into config (runtime middleware loading is skipped)
  config.middleware = {}

  const app = await bootstrap(config, { sessionId: parsed.meta.resume })

  // Replace loaded skills with bundled skills
  app.skillMap.clear()
  for (const [name, skill] of BUNDLED_SKILLS) {
    app.skillMap.set(name, skill)
  }

  // Merge bundled middleware into app middleware
  for (const [hook, fns] of Object.entries(BUNDLED_MIDDLEWARE)) {
    if (!fns || fns.length === 0) continue
    app.middleware[hook] = [...(app.middleware[hook] ?? []), ...fns]
  }

  const signals = onSignals(app.shutdown)

  app.logger.info('starting bundled interface', { interface: config.interface })

  switch (config.interface) {
    case 'mcp': {
      const handler = createMcpHandler(app)
      await startMcpHttp(app.config.mcp.server, handler, app.config.builtinTools ? app.tools : undefined)
      console.error('MCP server (http) listening on port ' + app.config.mcp.server.port)
      await new Promise(() => {})
      return
    }
    case 'mcp-stdio': {
      const handler = createMcpHandler(app)
      const isDevMode = /\\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? '')
      const mcpCommand = isDevMode ? 'bun' : process.argv[0]
      const mcpArgs = isDevMode ? [process.argv[1], '--mcp-stdio'] : ['--mcp-stdio']
      process.stderr.write('MCP stdio server starting.\\n')
      await startMcpStdio(app.config.mcp.server, handler, app.config.builtinTools ? app.tools : undefined)
      await app.shutdown()
      return
    }
    case 'http': {
      const httpServer = new HttpServer({
        port: app.config.http.port,
        token: app.config.http.token || undefined,
        model: app.config.model,
        provider: app.provider,
        tools: app.tools,
        storage: app.storage,
        systemPrompt: app.config.systemPrompt,
        skillMap: app.skillMap,
        maxIterations: app.config.maxIterations,
        toolTimeout: app.config.toolTimeout,
        middleware: app.middleware,
        thinking: app.config.thinking,
        compaction: app.config.compaction,
        contextMessages: app.contextMessages,
      })
      await httpServer.start()
      console.error('HTTP server listening on port ' + httpServer.port)
      signals.remove()
      onSignals(async () => {
        await httpServer.stop()
        await app.shutdown()
      })
      await new Promise(() => {})
      return
    }
    case 'cli': {
      if (!parsed.meta.prompt) {
        console.error('Error: --cli requires a prompt argument')
        process.exit(1)
      }
      const sessionMessages = parsed.meta.resume ? await app.storage.readMessages(app.sessionId) : []
      const activeSkills = app.config.skills.concat(parsed.meta.skills)
      const result = await runCli({
        prompt: parsed.meta.prompt,
        files: parsed.meta.files,
        skills: activeSkills,
        systemPrompt: app.config.systemPrompt,
        model: app.config.model,
        provider: app.provider,
        tools: app.tools,
        skillMap: app.skillMap,
        maxIterations: app.config.maxIterations,
        middleware: app.middleware,
        thinking: app.config.thinking,
        compaction: app.config.compaction,
        contextMessages: app.contextMessages,
        sessionMessages,
      })
      for (const msg of result.messages.slice(result.priorCount)) {
        await app.storage.appendMessage(app.sessionId, msg)
      }
      process.stdout.write('\\n')
      await app.shutdown()
      return
    }
    default: {
      if (parsed.meta.prompt && !parsed.config.interface) {
        // CLI mode when prompt given without interface flag
        const sessionMessages = parsed.meta.resume ? await app.storage.readMessages(app.sessionId) : []
        const activeSkills = app.config.skills.concat(parsed.meta.skills)
        const result = await runCli({
          prompt: parsed.meta.prompt,
          files: parsed.meta.files,
          skills: activeSkills,
          systemPrompt: app.config.systemPrompt,
          model: app.config.model,
          provider: app.provider,
          tools: app.tools,
          skillMap: app.skillMap,
          maxIterations: app.config.maxIterations,
          middleware: app.middleware,
          thinking: app.config.thinking,
          compaction: app.config.compaction,
          contextMessages: app.contextMessages,
          sessionMessages,
        })
        for (const msg of result.messages.slice(result.priorCount)) {
          await app.storage.appendMessage(app.sessionId, msg)
        }
        process.stdout.write('\\n')
        await app.shutdown()
        return
      }
      const repl = new Repl({
        model: app.config.model,
        provider: app.provider,
        tools: app.tools,
        storage: app.storage,
        systemPrompt: app.config.systemPrompt,
        skillMap: app.skillMap,
        maxIterations: app.config.maxIterations,
        toolTimeout: app.config.toolTimeout,
        sessionId: app.sessionId,
        middleware: app.middleware,
        thinking: app.config.thinking,
        compaction: app.config.compaction,
        contextMessages: app.contextMessages,
        memoryStore: app.memoryStore,
      })
      await repl.start()
      await app.shutdown()
    }
  }
}

function createMcpHandler(app) {
  return async (input) => {
    const loop = new AgentLoop({
      provider: app.provider,
      tools: app.tools,
      model: app.config.model,
      maxIterations: app.config.maxIterations,
      toolTimeout: app.config.toolTimeout,
      middleware: app.middleware,
      compaction: app.config.compaction,
    })
    const prompt = typeof input === 'string' ? input : JSON.stringify(input)
    const messages = []
    if (app.config.systemPrompt) messages.push({ role: 'system', content: app.config.systemPrompt })
    messages.push(...app.contextMessages, { role: 'user', content: prompt })
    const result = await loop.run(messages)
    const last = result.messages.at(-1)
    return last ? serializeContent(last.content) : ''
  }
}

main().catch((err) => {
  console.error(errorMessage(err))
  process.exit(1)
})`)

  return lines.join('\n')
}

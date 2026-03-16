#!/usr/bin/env bun
import { loadConfig } from './config'
import { bootstrap, toBaseOptions, type AppContext } from './bootstrap'
import { parseArgs } from './interfaces/parse-args'
import { errorMessage } from './utils/errors'
import { HELP } from './interfaces/help'
import { runExecScript, runSkillCommand, showContext, runMemoryCommand } from './interfaces/commands'
import { runCli } from './interfaces/cli'
import { HttpServer, toHttpOptions } from './interfaces/http'
import { AgentLoop } from './agent/loop'
import type { IMessage } from './providers/types'
import { startMcpStdio, startMcpHttp, serveMcpHttp } from './mcp/server'
import { serializeContent } from './providers/utils'
import type { RaConfig } from './config/types'
import { bootstrapAgents, type MultiAgentContext } from './multi-agent'
import { MultiAgentRepl } from './interfaces/multi-agent-repl'

// ── Helpers ──────────────────────────────────────────────────────────

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf-8').trim()
  return text || undefined
}

function onSignals(fn: () => Promise<void>): { remove: () => void } {
  const handler = async () => { await fn(); process.exit(0) }
  process.on('SIGINT', handler)
  process.on('SIGTERM', handler)
  return {
    remove: () => {
      process.off('SIGINT', handler)
      process.off('SIGTERM', handler)
    },
  }
}

function resolveAgent(ctx: MultiAgentContext, name?: string): AppContext {
  const agentName = name ?? ctx.defaultAgent
  const app = ctx.agents.get(agentName)
  if (!app) throw new Error(`Unknown agent "${agentName}". Available: ${[...ctx.agents.keys()].join(', ')}`)
  return app
}

// ── Early exits (no config/bootstrap needed) ─────────────────────────

async function handleEarlyExits(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  if (parsed.meta.exec) {
    await runExecScript(parsed.meta.exec)
    process.exit(0)
  }
  if (parsed.meta.version) {
    const { versionString } = await import('./version')
    console.log(versionString())
    process.exit(0)
  }
  if (parsed.meta.help) {
    console.log(HELP)
    process.exit(0)
  }
  if (parsed.meta.skillCommand) {
    await runSkillCommand(parsed.meta.skillCommand)
  }
}

// ── Standalone commands (need bootstrap but no interface) ────────────

async function handleStandaloneCommands(
  parsed: ReturnType<typeof parseArgs>,
  app: AppContext,
): Promise<boolean> {
  if (parsed.meta.showContext) {
    showContext(app.contextMessages)
    return true
  }

  if (parsed.meta.listMemories || parsed.meta.memories !== undefined) {
    runMemoryCommand(app.memoryStore, { list: parsed.meta.listMemories, search: parsed.meta.memories })
    return true
  }

  if (parsed.meta.forget !== undefined) {
    runMemoryCommand(app.memoryStore, { forget: parsed.meta.forget })
    return true
  }

  return false
}

// ── MCP helpers ──────────────────────────────────────────────────────

function createMcpHandler(app: AppContext) {
  return async (input: unknown) => {
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
    const messages: IMessage[] = []
    if (app.config.systemPrompt) messages.push({ role: 'system', content: app.config.systemPrompt })
    messages.push(...app.contextMessages, { role: 'user', content: prompt })
    const result = await loop.run(messages)
    const last = result.messages.at(-1)
    return last ? serializeContent(last.content) : ''
  }
}

function mcpToolsFor(app: AppContext) {
  return app.config.builtinTools ? app.tools : undefined
}

async function startSidecarMcp(app: AppContext): Promise<(() => Promise<void>) | null> {
  if (!app.config.mcp.server?.enabled) return null
  const handler = createMcpHandler(app)
  const stop = await startMcpHttp(app.config.mcp.server, handler, mcpToolsFor(app))
  console.error(`MCP server (http) listening on port ${app.config.mcp.server.port}`)
  return stop
}

// ── Interface launchers ──────────────────────────────────────────────

async function launchCli(parsed: ReturnType<typeof parseArgs>, ctx: MultiAgentContext): Promise<void> {
  let app = resolveAgent(ctx, parsed.meta.agent)

  if (!parsed.meta.prompt) {
    console.error('Error: --cli requires a prompt argument')
    process.exit(1)
  }

  // Handle --resume by re-bootstrapping the target agent
  if (parsed.meta.resume) {
    const oldApp = app
    await oldApp.shutdown()
    app = await bootstrap(oldApp.config, { sessionId: parsed.meta.resume })
    ctx.agents.set(parsed.meta.agent ?? ctx.defaultAgent, app)
  }

  const sessionMessages = parsed.meta.resume ? await app.storage.readMessages(app.sessionId) : []
  if (parsed.meta.resume) {
    app.logger.info('resuming session', { sessionId: app.sessionId, messageCount: sessionMessages.length })
  }
  const activeSkills = app.config.skills.concat(parsed.meta.skills)
  const result = await runCli({
    ...toBaseOptions(app),
    prompt: parsed.meta.prompt!,
    files: parsed.meta.files,
    skills: activeSkills,
    sessionMessages,
  })
  for (const msg of result.messages.slice(result.priorCount)) {
    await app.storage.appendMessage(app.sessionId, msg)
  }
  process.stdout.write('\n')
  await ctx.shutdown()
}

async function launchHttp(ctx: MultiAgentContext, config: RaConfig, signals: { remove: () => void }): Promise<void> {
  const defaultApp = resolveAgent(ctx)
  const stopMcpHttp = await startSidecarMcp(defaultApp)

  const opts = toHttpOptions(defaultApp, { agents: ctx })
  opts.port = config.http.port
  opts.token = config.http.token || undefined

  const httpServer = new HttpServer(opts)
  await httpServer.start()
  console.error(`HTTP server listening on port ${httpServer.port}`)

  const httpShutdown = async () => {
    try { await httpServer.stop() } catch { /* best-effort */ }
    try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort */ }
    await ctx.shutdown()
  }
  signals.remove()
  onSignals(httpShutdown)
  await new Promise(() => {}) // keep alive
}

async function launchRepl(ctx: MultiAgentContext): Promise<void> {
  const defaultApp = resolveAgent(ctx)
  const stopMcpHttp = await startSidecarMcp(defaultApp)
  const repl = new MultiAgentRepl(ctx)
  await repl.start()
  try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort */ }
  await ctx.shutdown()
}

async function launchMcp(ctx: MultiAgentContext, config: RaConfig): Promise<void> {
  // Single-agent: use the standard MCP server with configurable tool name
  if (ctx.agents.size === 1) {
    const app = ctx.agents.values().next().value!
    const handler = createMcpHandler(app)

    if (config.interface === 'mcp-stdio') {
      const isDevMode = /\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? '')
      const mcpCommand = isDevMode ? 'bun' : process.argv[0]!
      const mcpArgs = isDevMode ? [process.argv[1]!, '--mcp-stdio'] : ['--mcp-stdio']
      const mcpConfig = JSON.stringify({ mcpServers: { ra: { command: mcpCommand, args: mcpArgs } } }, null, 2)
      process.stderr.write(
        `MCP stdio server starting.\n\n` +
        `Cursor — .cursor/mcp.json:\n${mcpConfig}\n\n` +
        `Claude Desktop — ~/Library/Application Support/Claude/claude_desktop_config.json:\n${mcpConfig}\n\n`
      )
      await startMcpStdio(app.config.mcp.server, handler, mcpToolsFor(app))
      await ctx.shutdown()
    } else {
      await startMcpHttp(app.config.mcp.server, handler, mcpToolsFor(app))
      console.error(`MCP server (http) listening on port ${app.config.mcp.server.port}`)
      await new Promise(() => {}) // keep alive
    }
    return
  }

  // Multi-agent: expose each agent as a separate MCP tool
  const [{ z }, { McpServer }] = await Promise.all([
    import('zod'),
    import('@modelcontextprotocol/sdk/server/mcp.js'),
  ])

  const server = new McpServer({ name: 'ra-multi-agent', version: '1.0.0' })

  const handlers = new Map<string, ReturnType<typeof createMcpHandler>>()
  for (const [name, app] of ctx.agents) handlers.set(name, createMcpHandler(app))

  for (const [name, app] of ctx.agents) {
    const handler = handlers.get(name)!
    server.tool(
      name,
      `Agent: ${name} (${app.config.provider}/${app.config.model})`,
      { prompt: z.string().describe('The prompt to send to the agent') },
      async ({ prompt }) => {
        const text = await handler(prompt)
        return { content: [{ type: 'text' as const, text }] }
      },
    )
  }

  if (config.interface === 'mcp-stdio') {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
    process.stderr.write(`MCP stdio server starting with agents: ${[...ctx.agents.keys()].join(', ')}\n`)
    await server.connect(new StdioServerTransport())
    await ctx.shutdown()
  } else {
    const firstApp = ctx.agents.values().next().value!
    const port = firstApp.config.mcp.server?.port ?? 3100
    await serveMcpHttp(server, port)
    console.error(`MCP server (http) listening on port ${port}`)
    await new Promise(() => {}) // keep alive
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  await handleEarlyExits(parsed)

  // Read piped stdin (only for CLI / unspecified mode)
  const isNonCliInterface = parsed.config.interface && parsed.config.interface !== 'cli'
  if (!isNonCliInterface) {
    const stdinContent = await readStdin()
    if (stdinContent) {
      parsed.meta.prompt = parsed.meta.prompt
        ? `${parsed.meta.prompt}\n\n${stdinContent}`
        : stdinContent
      parsed.config.interface = 'cli' as const
    }
  }

  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: parsed.meta.configPath,
    cliArgs: parsed.config,
    env: process.env as Record<string, string | undefined>,
  })

  const ctx = await bootstrapAgents(config)
  const signals = onSignals(ctx.shutdown)

  // Standalone commands target the specified (or default) agent
  const targetApp = resolveAgent(ctx, parsed.meta.agent)
  if (await handleStandaloneCommands(parsed, targetApp)) {
    await ctx.shutdown()
    process.exit(0)
  }

  targetApp.logger.info('starting interface', { interface: config.interface })

  switch (config.interface) {
    case 'mcp':
    case 'mcp-stdio': return launchMcp(ctx, config)
    case 'http':      return launchHttp(ctx, config, signals)
    case 'cli':       return launchCli(parsed, ctx)
    default: {
      if (parsed.meta.prompt && !parsed.config.interface) {
        return launchCli(parsed, ctx)
      }
      return launchRepl(ctx)
    }
  }
}

main().catch((err) => {
  console.error(errorMessage(err))
  process.exit(1)
})

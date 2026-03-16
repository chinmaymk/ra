#!/usr/bin/env bun
import { loadConfig } from './config'
import { bootstrap, type AppContext } from './bootstrap'
import { parseArgs } from './interfaces/parse-args'
import { errorMessage } from './utils/errors'
import { HELP } from './interfaces/help'
import { runExecScript, runSkillCommand, showContext, runMemoryCommand } from './interfaces/commands'
import { runCli } from './interfaces/cli'
import { Repl, toReplOptions } from './interfaces/repl'
import { HttpServer, toHttpOptions } from './interfaces/http'
import { AgentLoop } from './agent/loop'
import type { IMessage } from './providers/types'
import { startMcpStdio, startMcpHttp } from './mcp/server'
import { serializeContent } from './providers/utils'
import type { RaConfig } from './config/types'
import { bootstrapMultiAgent, type MultiAgentContext } from './multi-agent'
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
): Promise<void> {
  if (parsed.meta.showContext) {
    showContext(app.contextMessages)
    await app.shutdown()
    process.exit(0)
  }

  if (parsed.meta.listMemories || parsed.meta.memories !== undefined) {
    runMemoryCommand(app.memoryStore, { list: parsed.meta.listMemories, search: parsed.meta.memories })
    await app.shutdown()
    process.exit(0)
  }

  if (parsed.meta.forget !== undefined) {
    runMemoryCommand(app.memoryStore, { forget: parsed.meta.forget })
    await app.shutdown()
    process.exit(0)
  }
}

// ── Interface launchers ──────────────────────────────────────────────

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

async function launchMcpHttp(app: AppContext): Promise<void> {
  const handler = createMcpHandler(app)
  await startMcpHttp(app.config.mcp.server, handler, mcpToolsFor(app))
  console.error(`MCP server (http) listening on port ${app.config.mcp.server.port}`)
  await new Promise(() => {}) // keep alive
}

async function launchMcpStdio(app: AppContext): Promise<void> {
  const handler = createMcpHandler(app)
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
  await app.shutdown()
}

async function launchCli(parsed: ReturnType<typeof parseArgs>, app: AppContext): Promise<void> {
  if (!parsed.meta.prompt) {
    console.error('Error: --cli requires a prompt argument')
    process.exit(1)
  }
  const sessionMessages = parsed.meta.resume ? await app.storage.readMessages(app.sessionId) : []
  if (parsed.meta.resume) {
    app.logger.info('resuming session', { sessionId: app.sessionId, messageCount: sessionMessages.length })
  }
  const activeSkills = app.config.skills.concat(parsed.meta.skills)
  const result = await runCli({
    prompt: parsed.meta.prompt!,
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
  process.stdout.write('\n')
  await app.shutdown()
}

async function launchHttp(
  app: AppContext,
  signals: { remove: () => void },
  overrides?: { port?: number; token?: string; agents?: MultiAgentContext; shutdown?: () => Promise<void> },
): Promise<void> {
  const stopMcpHttp = overrides ? null : await startSidecarMcp(app)
  const opts = toHttpOptions(app, { agents: overrides?.agents })
  if (overrides?.port) opts.port = overrides.port
  if (overrides?.token) opts.token = overrides.token

  const httpServer = new HttpServer(opts)
  await httpServer.start()
  console.error(`HTTP server listening on port ${httpServer.port}`)

  const shutdownFn = overrides?.shutdown ?? app.shutdown
  const httpShutdown = async () => {
    try { await httpServer.stop() } catch { /* best-effort */ }
    try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort */ }
    await shutdownFn()
  }
  signals.remove()
  onSignals(httpShutdown)
  await new Promise(() => {}) // keep alive
}

async function launchRepl(app: AppContext): Promise<void> {
  const stopMcpHttp = await startSidecarMcp(app)
  const repl = new Repl(toReplOptions(app))
  await repl.start()
  try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort */ }
  await app.shutdown()
}

// ── Multi-agent launchers ─────────────────────────────────────────────

async function launchMultiAgent(
  parsed: ReturnType<typeof parseArgs>,
  config: RaConfig,
  ctx: MultiAgentContext,
): Promise<void> {
  const signals = onSignals(ctx.shutdown)

  // Standalone commands require --agent in multi-agent mode
  if (parsed.meta.showContext || parsed.meta.listMemories || parsed.meta.memories !== undefined || parsed.meta.forget !== undefined) {
    if (!parsed.meta.agent) {
      console.error('Error: --agent <name> is required for this command in multi-agent mode')
      await ctx.shutdown()
      process.exit(1)
    }
    const app = ctx.agents.get(parsed.meta.agent)
    if (!app) {
      console.error(`Error: unknown agent "${parsed.meta.agent}". Available: ${[...ctx.agents.keys()].join(', ')}`)
      await ctx.shutdown()
      process.exit(1)
    }
    await handleStandaloneCommands(parsed, app)
  }

  switch (config.interface) {
    case 'http': {
      return launchMultiAgentHttp(ctx, config, signals)
    }
    case 'mcp':
    case 'mcp-stdio': {
      return launchMultiAgentMcp(ctx, config)
    }
    case 'cli': {
      return launchMultiAgentCli(parsed, ctx)
    }
    default: {
      if (parsed.meta.prompt && !parsed.config.interface) {
        return launchMultiAgentCli(parsed, ctx)
      }
      return launchMultiAgentRepl(ctx)
    }
  }
}

async function launchMultiAgentRepl(ctx: MultiAgentContext): Promise<void> {
  const repl = new MultiAgentRepl(ctx)
  await repl.start()
  await ctx.shutdown()
}

async function launchMultiAgentCli(
  parsed: ReturnType<typeof parseArgs>,
  ctx: MultiAgentContext,
): Promise<void> {
  const agentName = parsed.meta.agent ?? ctx.defaultAgent
  let app = ctx.agents.get(agentName)
  if (!app) {
    console.error(`Error: unknown agent "${agentName}". Available: ${[...ctx.agents.keys()].join(', ')}`)
    await ctx.shutdown()
    process.exit(1)
  }
  // --resume: re-bootstrap the target agent with the resume sessionId
  if (parsed.meta.resume) {
    const oldApp = app
    await oldApp.shutdown()
    app = await bootstrap(oldApp.config, { sessionId: parsed.meta.resume })
    ctx.agents.set(agentName, app)
  }
  await launchCli(parsed, app)
  await ctx.shutdown()
}

async function launchMultiAgentHttp(
  ctx: MultiAgentContext,
  config: RaConfig,
  signals: { remove: () => void },
): Promise<void> {
  const firstApp = ctx.agents.values().next().value!
  return launchHttp(firstApp, signals, {
    port: config.http?.port ?? firstApp.config.http.port,
    token: config.http?.token || firstApp.config.http.token || undefined,
    agents: ctx,
    shutdown: ctx.shutdown,
  })
}

async function launchMultiAgentMcp(
  ctx: MultiAgentContext,
  config: RaConfig,
): Promise<void> {
  const [{ z }, { McpServer }] = await Promise.all([
    import('zod'),
    import('@modelcontextprotocol/sdk/server/mcp.js'),
  ])

  const server = new McpServer({ name: 'ra-multi-agent', version: '1.0.0' })

  // Pre-create handlers outside tool callbacks
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
    // Use StreamableHTTPServerTransport to serve the multi-agent McpServer over HTTP
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
    const { createServer } = await import('node:http')
    const { randomUUID } = await import('node:crypto')
    const firstApp = ctx.agents.values().next().value!
    const port = firstApp.config.mcp.server?.port ?? 3100
    const transports = new Map<string, StreamableHTTPServerTransport>()

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      if (url.pathname !== '/mcp') { res.writeHead(404).end('Not found'); return }
      const sessionId = (req.headers['mcp-session-id'] as string | undefined) ?? ''

      if (req.method === 'DELETE') {
        const t = transports.get(sessionId)
        if (!t) { res.writeHead(404).end('Session not found'); return }
        await t.close()
        transports.delete(sessionId)
        res.writeHead(200).end()
        return
      }

      let transport: StreamableHTTPServerTransport
      let isNew = false
      if (req.method === 'POST' && !sessionId) {
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
        transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId) }
        await server.connect(transport)
        isNew = true
      } else if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!
      } else {
        res.writeHead(400).end('Bad request: missing or invalid session')
        return
      }

      if (isNew && transport.sessionId) transports.set(transport.sessionId, transport)
      try {
        await transport.handleRequest(req, res)
        if (isNew && transport.sessionId && !transports.has(transport.sessionId)) {
          transports.set(transport.sessionId, transport)
        }
      } catch {
        if (isNew) {
          if (transport.sessionId) transports.delete(transport.sessionId)
          await transport.close().catch(() => {})
        }
        if (!res.headersSent) res.writeHead(500).end('Internal server error')
      }
    })

    await new Promise<void>((resolve, reject) => {
      httpServer.listen(port, () => resolve())
      httpServer.once('error', reject)
    })
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

  // Multi-agent mode
  if (config.agents && Object.keys(config.agents).length > 0) {
    const ctx = await bootstrapMultiAgent(config)
    return launchMultiAgent(parsed, config, ctx)
  }

  const app = await bootstrap(config, { sessionId: parsed.meta.resume })

  const signals = onSignals(app.shutdown)
  await handleStandaloneCommands(parsed, app)

  app.logger.info('starting interface', { interface: config.interface })

  switch (config.interface) {
    case 'mcp':       return launchMcpHttp(app)
    case 'mcp-stdio': return launchMcpStdio(app)
    case 'http':      return launchHttp(app, signals)
    case 'cli':
      return launchCli(parsed, app)
    default: {
      // CLI mode when prompt given without --cli flag
      if (parsed.meta.prompt && !parsed.config.interface) {
        return launchCli(parsed, app)
      }
      return launchRepl(app)
    }
  }
}

main().catch((err) => {
  console.error(errorMessage(err))
  process.exit(1)
})

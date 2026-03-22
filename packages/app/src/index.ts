#!/usr/bin/env bun
import { AgentLoop, serializeContent, errorMessage, type IMessage } from '@chinmaymk/ra'
import { loadConfig } from './config'
import type { RaConfig } from './config/types'
import { bootstrap, type AppContext } from './bootstrap'
import { parseArgs } from './interfaces/parse-args'
import { HELP } from './interfaces/help'
import { runExecScript, runSubCommand, showContext, runMemoryCommand, showConfig } from './interfaces/commands'
import { runCli } from './interfaces/cli'
import { Repl } from './interfaces/repl'
import { HttpServer } from './interfaces/http'
import { InspectorServer } from './interfaces/inspector'
import { startMcpStdio, startMcpHttp } from './mcp/server'
import { runCron } from './interfaces/cron'
import { createSessionMiddleware } from './agent/session'

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
  if (parsed.meta.subCommand) {
    await runSubCommand(parsed.meta.subCommand)
  }
}

// ── Standalone commands (need bootstrap but no interface) ────────────

async function handleStandaloneCommands(
  parsed: ReturnType<typeof parseArgs>,
  app: AppContext,
): Promise<void> {
  const { listMemories, memories, forget } = parsed.meta
  if (listMemories || memories !== undefined) {
    runMemoryCommand(app.memoryStore, { list: listMemories, search: memories })
  } else if (forget !== undefined) {
    runMemoryCommand(app.memoryStore, { forget })
  } else {
    return
  }
  await app.shutdown()
  process.exit(0)
}

// ── Interface launchers ──────────────────────────────────────────────

function createMcpHandler(app: AppContext) {
  return async (input: unknown) => {
    const session = await app.storage.create({
      provider: app.provider.name,
      model: app.config.agent.model,
      interface: 'mcp',
    })
    const messages: IMessage[] = []
    if (app.config.agent.systemPrompt) messages.push({ role: 'system', content: app.config.agent.systemPrompt })
    messages.push(...app.contextMessages)
    const priorCount = messages.length

    const prompt = typeof input === 'string' ? input : JSON.stringify(input)
    messages.push({ role: 'user', content: prompt })

    const loopSession = createSessionMiddleware(app.middleware, {
      storage: app.storage,
      sessionId: session.id,
      priorCount,
      logsEnabled: app.config.app.logsEnabled,
      logLevel: app.config.app.logLevel,
      tracesEnabled: app.config.app.tracesEnabled,
      logger: app.logger,
    })
    const loop = new AgentLoop({
      provider: app.provider,
      tools: app.tools,
      model: app.config.agent.model,
      maxIterations: app.config.agent.maxIterations,
      maxRetries: app.config.agent.maxRetries,
      toolTimeout: app.config.agent.toolTimeout,
      maxToolResponseSize: app.config.agent.tools.maxResponseSize,
      middleware: loopSession.middleware,
      compaction: app.config.agent.compaction,
      logger: loopSession.logger,
      sessionId: session.id,
    })
    const result = await loop.run(messages)
    const last = result.messages.at(-1)
    return last ? serializeContent(last.content) : ''
  }
}

function mcpToolsFor(app: AppContext) {
  return app.config.agent.tools.builtin ? app.tools : undefined
}

async function startSidecarMcp(app: AppContext): Promise<(() => Promise<void>) | null> {
  if (!app.config.app.mcpServer?.enabled) return null
  const handler = createMcpHandler(app)
  const stop = await startMcpHttp(app.config.app.mcpServer, handler, mcpToolsFor(app))
  console.error('MCP server (http) listening on port', app.config.app.mcpServer.port)
  return stop
}

async function launchMcpHttp(app: AppContext): Promise<void> {
  const handler = createMcpHandler(app)
  await startMcpHttp(app.config.app.mcpServer, handler, mcpToolsFor(app))
  console.error('MCP server (http) listening on port', app.config.app.mcpServer.port)
  await new Promise(() => {}) // keep alive
}

async function launchMcpStdio(app: AppContext): Promise<void> {
  const handler = createMcpHandler(app)
  const isDevMode = /\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? '')
  const mcpCommand = isDevMode ? 'bun' : (process.argv[0] ?? 'ra')
  const mcpArgs = isDevMode ? [process.argv[1] ?? '', '--mcp-stdio'] : ['--mcp-stdio']
  const mcpConfig = JSON.stringify({ mcpServers: { ra: { command: mcpCommand, args: mcpArgs } } }, null, 2)
  process.stderr.write(
    'MCP stdio server starting.\n\n' +
    'Cursor — .cursor/mcp.json:\n' + mcpConfig + '\n\n' +
    'Claude Desktop — ~/Library/Application Support/Claude/claude_desktop_config.json:\n' + mcpConfig + '\n\n'
  )
  await startMcpStdio(app.config.app.mcpServer, handler, mcpToolsFor(app))
  await app.shutdown()
}

async function launchCli(parsed: ReturnType<typeof parseArgs>, app: AppContext): Promise<void> {
  if (!parsed.meta.prompt) {
    console.error('Error: --cli requires a prompt argument')
    process.exit(1)
  }
  const sessionMessages = app.resumed ? await app.storage.readMessages(app.sessionId) : []
  if (app.resumed) {
    app.logger.info('resuming session', { sessionId: app.sessionId, messageCount: sessionMessages.length })
  }
  await runCli({
    prompt: parsed.meta.prompt as string,
    files: parsed.meta.files,
    systemPrompt: app.config.agent.systemPrompt,
    model: app.config.agent.model,
    provider: app.provider,
    tools: app.tools,
    skillIndex: app.skillIndex,
    maxIterations: app.config.agent.maxIterations,
    maxRetries: app.config.agent.maxRetries,
    maxToolResponseSize: app.config.agent.tools.maxResponseSize,
    middleware: app.middleware,
    thinking: app.config.agent.thinking,
    thinkingBudgetCap: app.config.agent.thinkingBudgetCap,
    compaction: app.config.agent.compaction,
    contextMessages: app.contextMessages,
    sessionMessages,
    logger: app.logger,
    logsEnabled: app.config.app.logsEnabled,
    logLevel: app.config.app.logLevel,
    tracesEnabled: app.config.app.tracesEnabled,
    storage: app.storage,
    sessionId: app.sessionId,
  })
  process.stdout.write('\n')
  await app.shutdown()
}

async function launchHttp(app: AppContext, signals: { remove: () => void }): Promise<void> {
  const stopMcpHttp = await startSidecarMcp(app)

  const httpServer = new HttpServer({
    port: app.config.app.http.port,
    token: app.config.app.http.token || undefined,
    model: app.config.agent.model,
    provider: app.provider,
    tools: app.tools,
    storage: app.storage,
    systemPrompt: app.config.agent.systemPrompt,
    skillIndex: app.skillIndex,
    maxIterations: app.config.agent.maxIterations,
    maxRetries: app.config.agent.maxRetries,
    toolTimeout: app.config.agent.toolTimeout,
    maxToolResponseSize: app.config.agent.tools.maxResponseSize,
    middleware: app.middleware,
    thinking: app.config.agent.thinking,
    thinkingBudgetCap: app.config.agent.thinkingBudgetCap,
    compaction: app.config.agent.compaction,
    contextMessages: app.contextMessages,
    logger: app.logger,
    logsEnabled: app.config.app.logsEnabled,
    logLevel: app.config.app.logLevel,
    tracesEnabled: app.config.app.tracesEnabled,
  })
  await httpServer.start()
  console.error('HTTP server listening on port', httpServer.port)

  const httpShutdown = async () => {
    try { await httpServer.stop() } catch { /* best-effort */ }
    try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort */ }
    await app.shutdown()
  }
  signals.remove()
  onSignals(httpShutdown)
  await new Promise(() => {}) // keep alive
}

async function launchRepl(app: AppContext): Promise<void> {
  const stopMcpHttp = await startSidecarMcp(app)

  const repl = new Repl({
    model: app.config.agent.model,
    provider: app.provider,
    tools: app.tools,
    storage: app.storage,
    systemPrompt: app.config.agent.systemPrompt,
    skillIndex: app.skillIndex,
    maxIterations: app.config.agent.maxIterations,
    maxRetries: app.config.agent.maxRetries,
    toolTimeout: app.config.agent.toolTimeout,
    maxToolResponseSize: app.config.agent.tools.maxResponseSize,
    sessionId: app.sessionId,
    resumed: app.resumed,
    middleware: app.middleware,
    thinking: app.config.agent.thinking,
    thinkingBudgetCap: app.config.agent.thinkingBudgetCap,
    compaction: app.config.agent.compaction,
    contextMessages: app.contextMessages,
    memoryStore: app.memoryStore,
    logger: app.logger,
    logsEnabled: app.config.app.logsEnabled,
    logLevel: app.config.app.logLevel,
    tracesEnabled: app.config.app.tracesEnabled,
  })
  await repl.start()
  try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort */ }
  await app.shutdown()
}

async function launchCron(app: AppContext, runImmediately: boolean): Promise<void> {
  const jobs = app.config.cron ?? []
  if (jobs.length === 0) {
    console.error('Error: no cron jobs defined in config')
    process.exit(1)
  }

  const controller = new AbortController()
  const origSignals = onSignals(async () => {
    controller.abort()
    await app.shutdown()
  })

  await runCron({
    app,
    jobs,
    signal: controller.signal,
    runImmediately,
    onJobStart: (job) => {
      process.stderr.write(`\n[cron] Running "${job.name}" (${new Date().toISOString()})\n`)
    },
    onJobEnd: (job, result) => {
      if (result.ok) {
        process.stderr.write(`[cron] "${job.name}" completed\n`)
      } else {
        process.stderr.write(`[cron] "${job.name}" failed: ${result.error}\n`)
      }
    },
  })

  origSignals.remove()
  await app.shutdown()
}

async function launchInspector(app: AppContext): Promise<void> {
  const inspector = new InspectorServer(app)
  await inspector.start()
  console.error('Inspector running at', 'http://localhost:' + String(inspector.port))
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  await handleEarlyExits(parsed)

  // Ensure parsed.config.app exists for interface assignment
  const parsedApp = (parsed.config.app ??= {} as Partial<RaConfig>['app'] & Record<string, unknown>) as Partial<RaConfig['app']>

  // Read piped stdin (only for CLI / unspecified mode)
  const isNonCliInterface = parsedApp.interface && parsedApp.interface !== 'cli'
  if (!isNonCliInterface) {
    const stdinContent = await readStdin()
    if (stdinContent) {
      parsed.meta.prompt = parsed.meta.prompt
        ? `${parsed.meta.prompt}\n\n${stdinContent}`
        : stdinContent
      parsedApp.interface = 'cli' as const
    }
  }

  // Infer CLI mode when a prompt is given without an explicit interface flag
  if (parsed.meta.prompt && !parsedApp.interface) {
    parsedApp.interface = 'cli' as const
  }

  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: parsed.meta.configPath,
    cliArgs: parsed.config,
    env: process.env as Record<string, string | undefined>,
    recipeName: parsed.meta.recipeName,
  })

  if (parsed.meta.showConfig || parsed.meta.showContext) {
    const { discoverContextFiles, buildContextMessages } = await import('./context')
    const contextFiles = config.agent.context.enabled
      ? await discoverContextFiles({ cwd: process.cwd(), patterns: config.agent.context.patterns })
      : []

    if (parsed.meta.showConfig) {
      showConfig(config, contextFiles.map(f => f.relativePath))
    }
    if (parsed.meta.showContext) {
      showContext(buildContextMessages(contextFiles))
    }
    process.exit(0)
  }

  const isInspector = config.app.interface === 'inspector'
  const app = await bootstrap(config, { resume: parsed.meta.resume, skipSession: isInspector })

  const signals = onSignals(app.shutdown)
  if (!isInspector) await handleStandaloneCommands(parsed, app)

  app.logger.info('starting interface', { interface: config.app.interface })

  switch (config.app.interface) {
    case 'mcp':       return launchMcpHttp(app)
    case 'mcp-stdio': return launchMcpStdio(app)
    case 'http':      return launchHttp(app, signals)
    case 'inspector': return launchInspector(app)
    case 'cron':      return launchCron(app, parsed.meta.runImmediately)
    case 'cli':       return launchCli(parsed, app)
    default:          return launchRepl(app)
  }
}

main().catch((err) => {
  console.error(errorMessage(err))
  process.exit(1)
})

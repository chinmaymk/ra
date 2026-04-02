/**
 * Interface launchers — each function wires up an AppContext to a specific
 * interface (CLI, REPL, HTTP, MCP, cron, inspector) and runs it.
 *
 * Extracted from index.ts to keep the entry point focused on arg parsing,
 * config loading, and dispatch.
 */
import {
  AgentLoop,
  serializeContent,
  type IMessage,
  type MiddlewareConfig,
} from '@chinmaymk/ra'
import type { AppContext } from '../bootstrap'
import type { ParsedArgs } from './parse-args'
import { createSessionMiddleware } from '../agent/session'
import { runCli } from './cli'
import { Repl } from './repl'
import { HttpServer } from './http'
import { InspectorServer } from './inspector'
import { startMcpStdio, startMcpHttp } from '../mcp/server'
import { runCron } from './cron'

// ── MCP handler ─────────────────────────────────────────────────────

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
      parallelToolCalls: app.config.agent.parallelToolCalls,
      maxTokenBudget: app.config.agent.maxTokenBudget,
      maxDuration: app.config.agent.maxDuration,
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
  if (!app.config.app.raMcpServer?.enabled) return null
  const handler = createMcpHandler(app)
  const stop = await startMcpHttp(app.config.app.raMcpServer, handler, mcpToolsFor(app))
  console.error('MCP server (http) listening on port', app.config.app.raMcpServer.port)
  return stop
}

// ── Launchers ───────────────────────────────────────────────────────

export async function launchMcpHttp(app: AppContext): Promise<void> {
  const handler = createMcpHandler(app)
  await startMcpHttp(app.config.app.raMcpServer, handler, mcpToolsFor(app))
  console.error('MCP server (http) listening on port', app.config.app.raMcpServer.port)
  await new Promise(() => {}) // keep alive
}

export async function launchMcpStdio(app: AppContext): Promise<void> {
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
  await startMcpStdio(app.config.app.raMcpServer, handler, mcpToolsFor(app))
  await app.shutdown()
}

export async function launchCli(parsed: ParsedArgs, app: AppContext): Promise<void> {
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

export async function launchHttp(
  app: AppContext,
  signals: { remove: () => void },
  onSignals: (fn: () => Promise<void>) => { remove: () => void },
): Promise<void> {
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

export async function launchRepl(app: AppContext): Promise<void> {
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

export async function launchCron(app: AppContext, runImmediately: boolean): Promise<void> {
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

export async function launchInspector(app: AppContext): Promise<void> {
  const inspector = new InspectorServer(app)
  await inspector.start()
  console.error('Inspector running at', 'http://localhost:' + String(inspector.port))
}

// ── Signal helpers (shared with index.ts) ───────────────────────────

export function onSignals(fn: () => Promise<void>): { remove: () => void } {
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

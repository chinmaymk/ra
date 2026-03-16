#!/usr/bin/env bun
import { loadConfig } from './config'
import { bootstrap, type AppContext } from './bootstrap'
import { parseArgs } from './interfaces/parse-args'
import { errorMessage } from './utils/errors'
import { HELP } from './interfaces/help'
import { runExecScript, runSkillCommand, showContext, runMemoryCommand } from './interfaces/commands'
import { runCli } from './interfaces/cli'
import { Repl } from './interfaces/repl'
import { HttpServer } from './interfaces/http'
import { AgentLoop } from './agent/loop'
import type { IMessage } from './providers/types'
import { startMcpStdio, startMcpHttp } from './mcp/server'
import { serializeContent } from './providers/utils'
import { withSessionHistory } from './storage/middleware'

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
    const session = await app.storage.create({
      provider: app.provider.name,
      model: app.config.model,
      interface: 'mcp',
    })
    const loop = new AgentLoop({
      provider: app.provider,
      tools: app.tools,
      model: app.config.model,
      maxIterations: app.config.maxIterations,
      toolTimeout: app.config.toolTimeout,
      middleware: withSessionHistory(app.middleware, app.storage),
      compaction: app.config.compaction,
      logger: app.logger,
      sessionId: session.id,
    })
    const prompt = typeof input === 'string' ? input : JSON.stringify(input)
    const userMessage: IMessage = { role: 'user', content: prompt }
    // Persist the user message immediately before starting the loop
    await app.storage.appendMessage(session.id, userMessage)
    const messages: IMessage[] = []
    if (app.config.systemPrompt) messages.push({ role: 'system', content: app.config.systemPrompt })
    messages.push(...app.contextMessages, userMessage)
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
  await runCli({
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
    logger: app.logger,
    storage: app.storage,
    sessionId: app.sessionId,
  })
  process.stdout.write('\n')
  await app.shutdown()
}

async function launchHttp(app: AppContext, signals: { remove: () => void }): Promise<void> {
  const stopMcpHttp = await startSidecarMcp(app)

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
    logger: app.logger,
  })
  await httpServer.start()
  console.error(`HTTP server listening on port ${httpServer.port}`)

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
    logger: app.logger,
  })
  await repl.start()
  try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort */ }
  await app.shutdown()
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

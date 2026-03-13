/**
 * Shared main loop — used by both src/index.ts (normal binary) and
 * bundled binaries.  Accepts a pre-bootstrapped AppContext and parsed
 * args, then launches the appropriate interface.
 */
import type { AppContext } from './bootstrap'
import type { ParsedArgs } from './interfaces/parse-args'
import { runCli } from './interfaces/cli'
import { Repl } from './interfaces/repl'
import { HttpServer } from './interfaces/http'
import { AgentLoop } from './agent/loop'
import type { IMessage } from './providers/types'
import { startMcpStdio, startMcpHttp } from './mcp/server'
import { serializeContent } from './providers/utils'

// ── Helpers ──────────────────────────────────────────────────────────

export async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf-8').trim()
  return text || undefined
}

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

async function launchCli(parsed: ParsedArgs, app: AppContext): Promise<void> {
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
  })
  await repl.start()
  try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort */ }
  await app.shutdown()
}

// ── Main entry ───────────────────────────────────────────────────────

/**
 * Launch the appropriate interface based on config.  Used by both the
 * normal ra binary and bundled custom binaries.
 */
export async function run(parsed: ParsedArgs, app: AppContext): Promise<void> {
  const signals = onSignals(app.shutdown)
  const config = app.config

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

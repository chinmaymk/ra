import type { OrchestratorContext } from './types'
import type { IMessage } from '../providers/types'
import type { StreamChunkContext } from '../agent/types'
import { AgentLoop } from '../agent/loop'
import { Repl } from '../interfaces/repl'
import { HttpServer } from '../interfaces/http'
import { runCli } from '../interfaces/cli'
import { parseRoute, isRouteError } from './router'
import type { AppContext } from '../bootstrap'

// ── CLI ──────────────────────────────────────────────────────────────

export async function launchOrchestratorCli(
  orchCtx: OrchestratorContext,
  prompt: string,
): Promise<void> {
  const agentNames = [...orchCtx.agents.keys()]
  const route = parseRoute(prompt, agentNames, orchCtx.defaultAgent)

  if (isRouteError(route)) {
    console.error(`Error: ${route.error}`)
    process.exit(1)
    return // unreachable, helps TS narrow
  }

  const app = orchCtx.agents.get(route.agentName)!

  const result = await runCli({
    prompt: route.message,
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
  })

  for (const msg of result.messages.slice(result.priorCount)) {
    await app.storage.appendMessage(app.sessionId, msg)
  }

  process.stdout.write('\n')
  await orchCtx.shutdown()
}

// ── REPL ─────────────────────────────────────────────────────────────

export async function launchOrchestratorRepl(
  orchCtx: OrchestratorContext,
): Promise<void> {
  // Use the default agent (or first agent) for the REPL session
  const defaultName = orchCtx.defaultAgent ?? [...orchCtx.agents.keys()][0]!
  const defaultApp = orchCtx.agents.get(defaultName)!
  const agentNames = [...orchCtx.agents.keys()]

  // Create a REPL using the default agent's config
  // Override processInput to handle agent routing
  const repl = new OrchestratorRepl(orchCtx, defaultName)
  await repl.start()
  await orchCtx.shutdown()
}

class OrchestratorRepl extends Repl {
  private orchCtx: OrchestratorContext
  private currentAgentName: string

  constructor(orchCtx: OrchestratorContext, defaultAgentName: string) {
    const app = orchCtx.agents.get(defaultAgentName)!
    super({
      model: app.config.model,
      provider: app.provider,
      tools: app.tools,
      storage: app.storage,
      systemPrompt: app.config.systemPrompt,
      skillMap: app.skillMap,
      middleware: app.middleware,
      maxIterations: app.config.maxIterations,
      toolTimeout: app.config.toolTimeout,
      sessionId: app.sessionId,
      thinking: app.config.thinking,
      compaction: app.config.compaction,
      contextMessages: app.contextMessages,
      memoryStore: app.memoryStore,
    })
    this.orchCtx = orchCtx
    this.currentAgentName = defaultAgentName
  }

  override async processInput(input: string): Promise<void> {
    const agentNames = [...this.orchCtx.agents.keys()]
    const route = parseRoute(input, agentNames, this.orchCtx.defaultAgent)

    if (isRouteError(route)) {
      const { printError } = await import('../interfaces/tui')
      printError(route.error)
      return
    }

    // If routing to a different agent, swap the underlying options
    if (route.agentName !== this.currentAgentName) {
      const app = this.orchCtx.agents.get(route.agentName)!
      this.swapAgent(app, route.agentName)
    }

    // Delegate to Repl.processInput with the cleaned message
    await super.processInput(route.message)
  }

  private swapAgent(app: AppContext, name: string): void {
    // Update the options used by the parent Repl for the next loop
    // The Repl constructor stores options as `this.options`
    // We access it through the same property
    ;(this as any).options = {
      model: app.config.model,
      provider: app.provider,
      tools: app.tools,
      storage: app.storage,
      systemPrompt: app.config.systemPrompt,
      skillMap: app.skillMap,
      middleware: app.middleware,
      maxIterations: app.config.maxIterations,
      toolTimeout: app.config.toolTimeout,
      sessionId: app.sessionId,
      thinking: app.config.thinking,
      compaction: app.config.compaction,
      contextMessages: app.contextMessages,
      memoryStore: app.memoryStore,
    }
    this.currentAgentName = name
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────

export async function launchOrchestratorHttp(
  orchCtx: OrchestratorContext,
  port: number,
  token?: string,
): Promise<void> {
  // Use the default agent for the main /chat endpoints
  const defaultName = orchCtx.defaultAgent ?? [...orchCtx.agents.keys()][0]!
  const defaultApp = orchCtx.agents.get(defaultName)!

  const httpServer = new HttpServer({
    port,
    token,
    model: defaultApp.config.model,
    provider: defaultApp.provider,
    tools: defaultApp.tools,
    storage: defaultApp.storage,
    systemPrompt: defaultApp.config.systemPrompt,
    skillMap: defaultApp.skillMap,
    middleware: defaultApp.middleware,
    maxIterations: defaultApp.config.maxIterations,
    toolTimeout: defaultApp.config.toolTimeout,
    thinking: defaultApp.config.thinking,
    compaction: defaultApp.config.compaction,
    contextMessages: defaultApp.contextMessages,
  })

  // Pre-create pool agents for each orchestrated agent
  for (const [name, app] of orchCtx.agents) {
    if (name === defaultName) continue
    httpServer.pool.create(name, {
      model: app.config.model,
      systemPrompt: app.config.systemPrompt,
      maxIterations: app.config.maxIterations,
      thinking: app.config.thinking,
    })
  }

  await httpServer.start()
  console.error(`HTTP server listening on port ${httpServer.port}`)
  console.error(`Agents: ${[...orchCtx.agents.keys()].join(', ')} (default: ${defaultName})`)

  await new Promise(() => {}) // keep alive
}

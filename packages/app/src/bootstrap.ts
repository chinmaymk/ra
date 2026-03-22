/**
 * Bootstrap — wires up all subsystems (provider, tools, middleware, skills,
 * memory, MCP, observability) from a resolved config.  Returns a single
 * `AppContext` that the interface layer can consume.
 */
import { mkdir } from 'node:fs/promises'
import {
  ToolRegistry,
  getDefaultCompactionModel,
  createProvider,
  buildProviderConfig,
  estimateTokens,
  type MiddlewareConfig,
  type IMessage,
  type IProvider,
  type Logger,
} from '@chinmaymk/ra'
import { createPermissionsMiddleware } from './agent/permissions'
import type { RaConfig } from './config/types'
import { discoverContextFiles, buildContextMessages, findGitRoot, createDiscoveryMiddleware, createSkillResolver } from './context'
import { createResolverMiddleware } from './context/resolve-middleware'
import { loadResolvers } from './context/resolver-loader'
import { McpClient } from './mcp/client'
import { MemoryStore, memorySearchTool, memorySaveTool, memoryForgetTool, createMemoryMiddleware } from './memory'
import { ScratchpadStore, scratchpadWriteTool, scratchpadDeleteTool, createScratchpadMiddleware } from './scratchpad'
import { loadMiddleware } from './middleware/loader'
import { createObservability } from './observability'
import { loadSkillIndex, buildAvailableSkillsXml } from './skills/loader'
import type { SkillIndex } from './skills/types'
import { SessionStorage } from './storage/sessions'
import { registerBuiltinTools, subagentTool } from './tools'
import { resolvePath } from './utils/paths'
import type { Tracer } from './observability/tracer'
import type { Middleware } from '@chinmaymk/ra'

/** Prepend a middleware to a hook array (creates the array if needed). */
function prepend<T>(arr: Middleware<T>[] | undefined, mw: Middleware<T>): Middleware<T>[] {
  return [mw, ...(arr ?? [])]
}
/** Append a middleware to a hook array (creates the array if needed). */
function append<T>(arr: Middleware<T>[] | undefined, mw: Middleware<T>): Middleware<T>[] {
  return [...(arr ?? []), mw]
}

export interface AppContext {
  config: RaConfig
  provider: IProvider
  tools: ToolRegistry
  middleware: Partial<MiddlewareConfig>
  skillIndex: Map<string, SkillIndex>
  storage: SessionStorage
  sessionId: string
  resumed: boolean
  contextMessages: IMessage[]
  memoryStore: MemoryStore | undefined
  scratchpadStore: ScratchpadStore | undefined
  mcpClient: McpClient
  logger: Logger
  tracer: Tracer
  shutdown: () => Promise<void>
}

export async function bootstrap(
  config: RaConfig,
  opts: { resume?: string | true; skipSession?: boolean },
): Promise<AppContext> {
  const { app, agent } = config

  // ── Paths derived from dataDir ───────────────────────────────────
  const { join } = await import('path')
  const storagePath = join(app.dataDir, 'sessions')
  const memoryPath = join(app.dataDir, 'memory.db')

  // ── Storage & session ──────────────────────────────────────────────
  const storage = new SessionStorage(storagePath)
  await storage.init()

  let sessionId: string
  let sessionDir: string | undefined
  if (opts.skipSession) {
    sessionId = 'none'
  } else if (opts.resume) {
    if (opts.resume === true) {
      const latest = await storage.latest()
      if (!latest) throw new Error('No sessions to resume')
      sessionId = latest.id
    } else {
      const ensured = await storage.ensureSession(opts.resume, {
        provider: agent.provider,
        model: agent.model,
        interface: app.interface,
      })
      sessionId = ensured.id
    }
    sessionDir = storage.sessionDir(sessionId)
    await mkdir(sessionDir, { recursive: true })
  } else {
    sessionId = (await storage.create({
      provider: agent.provider,
      model: agent.model,
      interface: app.interface,
    })).id
    sessionDir = storage.sessionDir(sessionId)
    await mkdir(sessionDir, { recursive: true })
  }

  // ── Observability ──────────────────────────────────────────────────
  const { logger, tracer } = createObservability({
    enabled: !opts.skipSession && (app.logsEnabled || app.tracesEnabled),
    logs: { enabled: app.logsEnabled, level: app.logLevel, output: 'session' },
    traces: { enabled: app.tracesEnabled, output: 'session' },
  }, { sessionId, sessionDir })

  if (opts.resume) {
    logger.info('session resumed', { sessionId, sessionDir })
  }

  const bootstrapTokenSpan = tracer.startSpan('bootstrap.tokenBudget')

  // ── Compaction model default ───────────────────────────────────────
  if (!agent.compaction.model) {
    agent.compaction.model = getDefaultCompactionModel(agent.provider) || undefined
  }
  agent.compaction.onCompact = (info) => logger.info('context compacted', info)

  // ── Context files ──────────────────────────────────────────────────
  const contextSpan = tracer.startSpan('context.discovery', { patterns: agent.context.patterns })
  const contextFiles = agent.context.enabled
    ? await discoverContextFiles({ cwd: process.cwd(), patterns: agent.context.patterns })
    : []
  const contextMessages = buildContextMessages(contextFiles)

  if (contextFiles.length > 0) {
    const contextTokens = estimateTokens(contextMessages)
    logger.info('context files discovered', {
      fileCount: contextFiles.length,
      patterns: agent.context.patterns,
      files: contextFiles.map(f => f.relativePath),
      estimatedTokens: contextTokens,
    })
    tracer.endSpan(contextSpan, 'ok', {
      fileCount: contextFiles.length,
      estimatedTokens: contextTokens,
      files: contextFiles.map(f => f.relativePath),
    })
  } else {
    tracer.endSpan(contextSpan, 'ok', { fileCount: 0 })
  }

  // ── Middleware ──────────────────────────────────────────────────────
  const middleware: Partial<MiddlewareConfig> = await loadMiddleware(config, app.configDir)
  const userHookCount = Object.values(middleware).reduce((n, hooks) => n + (hooks?.length ?? 0), 0)
  if (userHookCount > 0) {
    logger.info('custom middleware loaded', { hookCount: userHookCount })
  }

  // Pattern resolvers (e.g. @file, url:)
  if (agent.context.resolvers?.length) {
    const resolvers = await loadResolvers(agent.context.resolvers, app.configDir)
    if (resolvers.length > 0) {
      const resolverMw = createResolverMiddleware(resolvers, process.cwd())
      middleware.beforeModelCall = prepend(middleware.beforeModelCall, resolverMw)
    }
  }

  // Dynamic context discovery — picks up context files from directories referenced in messages
  if (agent.context.enabled) {
    const root = (await findGitRoot(process.cwd())) ?? process.cwd()
    const discoveryMw = createDiscoveryMiddleware(agent.context.patterns, root, new Set(contextFiles.map(f => f.path)), { subdirectoryWalk: agent.context.subdirectoryWalk })
    middleware.beforeModelCall = append(middleware.beforeModelCall, discoveryMw)
  }

  // ── Provider ───────────────────────────────────────────────────────
  const provider = createProvider(buildProviderConfig(agent.provider, app.providers[agent.provider]))
  logger.info('provider initialized', { provider: agent.provider, model: agent.model })

  // ── Tools ──────────────────────────────────────────────────────────
  const tools = new ToolRegistry()
  if (agent.tools.builtin || Object.keys(agent.tools.overrides).length > 0) {
    registerBuiltinTools(tools, agent.tools)
  }

  const allTools = tools.all()
  const toolNames = allTools.map(t => t.name)
  if (toolNames.length > 0) {
    const toolTokens = estimateTokens(allTools)
    logger.info('tools registered', { toolCount: toolNames.length, tools: toolNames, estimatedTokens: toolTokens })
  }

  // ── Memory ─────────────────────────────────────────────────────────
  let memoryStore: MemoryStore | undefined
  if (agent.memory.enabled) {
    memoryStore = new MemoryStore({
      path: memoryPath,
      maxMemories: agent.memory.maxMemories,
      ttlDays: agent.memory.ttlDays,
    })
    tools.register(memorySearchTool(memoryStore))
    tools.register(memorySaveTool(memoryStore))
    tools.register(memoryForgetTool(memoryStore))

    const memMw = createMemoryMiddleware({ store: memoryStore, injectLimit: agent.memory.injectLimit })
    middleware.beforeLoopBegin = prepend(middleware.beforeLoopBegin, memMw.beforeLoopBegin)
    logger.info('memory store initialized', { path: memoryPath, memoriesStored: memoryStore.count() })
  }

  // ── Scratchpad ───────────────────────────────────────────────────
  // Enabled by default when builtin tools are on; disable via tools.overrides.scratchpad.enabled: false
  const scratchpadEnabled =
    agent.tools.overrides.scratchpad?.enabled !== false &&
    agent.tools.builtin
  let scratchpadStore: ScratchpadStore | undefined
  if (scratchpadEnabled) {
    scratchpadStore = new ScratchpadStore()
    tools.register(scratchpadWriteTool(scratchpadStore))
    tools.register(scratchpadDeleteTool(scratchpadStore))

    const scratchpadMw = createScratchpadMiddleware(scratchpadStore)
    middleware.beforeModelCall = append(middleware.beforeModelCall, scratchpadMw)
    logger.info('scratchpad initialized')
  }

  // ── Skills ─────────────────────────────────────────────────────────
  const resolvedSkillDirs = app.skillDirs.map(d => resolvePath(d, app.configDir))
  const skillIndex = await loadSkillIndex(resolvedSkillDirs)
  if (skillIndex.size > 0) {
    const availableXml = buildAvailableSkillsXml(skillIndex)
    const skillTokens = estimateTokens(availableXml)
    logger.info('skills indexed', {
      skillCount: skillIndex.size,
      skills: [...skillIndex.keys()],
      estimatedTokens: skillTokens,
    })

    // Skill pattern resolver — lazy-loads full skill on first /skill-name reference
    const skillResolver = createSkillResolver(skillIndex)
    const skillResolverMw = createResolverMiddleware([skillResolver], process.cwd())
    middleware.beforeModelCall = prepend(middleware.beforeModelCall, skillResolverMw)
  }

  // ── MCP clients ────────────────────────────────────────────────────
  const mcpClient = new McpClient()
  if (app.mcp.client?.length) {
    const mcpSpan = tracer.startSpan('mcp.connect', { serverCount: app.mcp.client.length })
    logger.info('connecting to MCP servers', { serverCount: app.mcp.client.length, servers: app.mcp.client.map(c => c.name) })
    const knownToolNames = new Set(tools.all().map(t => t.name))
    await mcpClient.connect(app.mcp.client, tools, { lazySchemas: app.mcp.lazySchemas })
    const mcpTools = tools.all().filter(t => !knownToolNames.has(t.name))
    const mcpToolTokens = estimateTokens(mcpTools)
    logger.info('MCP servers connected', {
      totalTools: tools.all().length,
      mcpToolCount: mcpTools.length,
      lazySchemas: app.mcp.lazySchemas,
      estimatedMcpToolTokens: mcpToolTokens,
    })
    tracer.endSpan(mcpSpan, 'ok', {
      mcpToolCount: mcpTools.length,
      estimatedTokens: mcpToolTokens,
      lazySchemas: app.mcp.lazySchemas,
    })
  }

  // ── Permissions middleware ─────────────────────────────────────────
  if (app.permissions.rules?.length && !app.permissions.no_rules_rules) {
    const permMw = createPermissionsMiddleware(app.permissions)
    middleware.beforeToolExecution = prepend(middleware.beforeToolExecution, permMw)
    logger.info('permissions middleware loaded', { ruleCount: app.permissions.rules.length })
  }

  // ── Subagent tool (registered last — child registry built lazily) ──
  const agentSettings = agent.tools.overrides.Agent ?? {}
  const agentEnabled = agentSettings.enabled !== false && agent.tools.builtin
  if (agentEnabled) {
    const agentMaxConcurrency = (agentSettings.maxConcurrency as number | undefined) ?? agent.maxConcurrency
    tools.register(subagentTool({
      provider,
      tools,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      middleware,
      thinking: agent.thinking,
      compaction: agent.compaction,
      toolTimeout: agent.toolTimeout,
      maxIterations: agent.maxIterations,
      maxConcurrency: agentMaxConcurrency,
      logger,
    }))
  }

  // ── Token budget summary ─────────────────────────────────────────
  {
    const allRegisteredTools = tools.all()
    const contextTokens = estimateTokens(contextMessages)
    const skillTokens = estimateTokens(buildAvailableSkillsXml(skillIndex))
    const toolSchemaTokens = estimateTokens(allRegisteredTools)
    const totalEstimated = contextTokens + skillTokens + toolSchemaTokens
    logger.info('bootstrap token estimate', {
      contextFiles: contextTokens,
      skills: skillTokens,
      toolSchemas: toolSchemaTokens,
      total: totalEstimated,
    })
    tracer.endSpan(bootstrapTokenSpan, 'ok', {
      contextFiles: contextTokens,
      skills: skillTokens,
      toolSchemas: toolSchemaTokens,
      total: totalEstimated,
    })
  }

  // ── Shutdown ───────────────────────────────────────────────────────
  const shutdown = async () => {
    logger.info('shutting down')
    try { await mcpClient.disconnect() } catch { /* best-effort */ }
    if (memoryStore) memoryStore.close()
    await logger.flush()
    await tracer.flush()
  }

  return {
    config,
    provider,
    tools,
    middleware,
    skillIndex,
    storage,
    sessionId,
    resumed: !!opts.resume,
    contextMessages,
    memoryStore,
    scratchpadStore,
    mcpClient,
    logger,
    tracer,
    shutdown,
  }
}

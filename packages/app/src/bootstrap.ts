/**
 * Bootstrap — wires up all subsystems (provider, tools, middleware, skills,
 * memory, MCP, observability) from a resolved config.  Returns a single
 * `AppContext` that the interface layer can consume.
 */
import { mkdir, writeFile } from 'node:fs/promises'
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
import type { RaConfig, LoadConfigOptions } from './config/types'
import { ConfigManager } from './config/manager'
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
import { loadCustomTools } from './tools/loader'
import { resolvePath, configHandle } from './utils/paths'
import type { Tracer } from './observability/tracer'
import type { Middleware } from '@chinmaymk/ra'

/**
 * Check config mtime and rebuild derived state if the file changed.
 * Rebuilds: provider, builtin tools, custom tools, middleware, skills, context.
 * Preserves: storage, MCP connections, memory/scratchpad stores, observability.
 */
async function refreshAppContext(ctx: AppContext, configManager: ConfigManager): Promise<boolean> {
  const reloaded = await configManager.maybeReload(ctx.logger)
  if (!reloaded) return false

  const prev = ctx.config
  const next = configManager.config
  ctx.config = next

  const { app, agent } = next

  // ── Provider ────────────────────────────────────────────────────
  const providerChanged =
    agent.provider !== prev.agent.provider ||
    JSON.stringify(app.providers[agent.provider]) !== JSON.stringify(prev.app.providers[prev.agent.provider])

  if (providerChanged) {
    ctx.provider = createProvider(buildProviderConfig(agent.provider, app.providers[agent.provider]))
    ctx.logger.info('provider rebuilt', { provider: agent.provider, model: agent.model })
  }

  // ── Tools (builtin + custom, skip MCP — connections are long-lived) ─
  const toolsChanged =
    JSON.stringify(agent.tools) !== JSON.stringify(prev.agent.tools)

  if (toolsChanged) {
    const newTools = new ToolRegistry()
    if (agent.tools.builtin || Object.keys(agent.tools.overrides).length > 0) {
      registerBuiltinTools(newTools, agent.tools)
    }
    if (agent.tools.custom?.length) {
      const customTools = await loadCustomTools(agent.tools.custom, app.configDir, ctx.logger)
      for (const tool of customTools) newTools.register(tool)
    }
    // Re-register memory/scratchpad tools (they reference existing stores)
    if (ctx.memoryStore) {
      newTools.register(memorySearchTool(ctx.memoryStore))
      newTools.register(memorySaveTool(ctx.memoryStore))
      newTools.register(memoryForgetTool(ctx.memoryStore))
    }
    if (ctx.scratchpadStore) {
      newTools.register(scratchpadWriteTool(ctx.scratchpadStore))
      newTools.register(scratchpadDeleteTool(ctx.scratchpadStore))
    }
    // Re-register MCP tools from existing connections
    for (const tool of ctx.tools.all()) {
      if (!newTools.get(tool.name)) newTools.register(tool)
    }
    // Re-register subagent tool
    const agentSettings = agent.tools.overrides.Agent ?? {}
    if (agentSettings.enabled !== false && agent.tools.builtin) {
      newTools.register(subagentTool({
        provider: ctx.provider,
        tools: newTools,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        middleware: ctx.middleware,
        thinking: agent.thinking,
        thinkingBudgetCap: agent.thinkingBudgetCap,
        compaction: agent.compaction,
        toolTimeout: agent.toolTimeout,
        maxIterations: agent.maxIterations,
        maxConcurrency: (agentSettings.maxConcurrency as number | undefined) ?? agent.maxConcurrency,
        logger: ctx.logger,
      }))
    }
    ctx.tools = newTools
    ctx.logger.info('tools rebuilt', { toolCount: newTools.all().length })
  }

  // ── Middleware ───────────────────────────────────────────────────
  const middlewareChanged =
    JSON.stringify(agent.middleware) !== JSON.stringify(prev.agent.middleware)

  if (middlewareChanged) {
    const mw: Partial<MiddlewareConfig> = await loadMiddleware(next, app.configDir, ctx.logger)

    if (agent.context.enabled) {
      const root = (await findGitRoot(process.cwd())) ?? process.cwd()
      const discoveryMw = createDiscoveryMiddleware(agent.context.patterns, root, new Set(), { subdirectoryWalk: agent.context.subdirectoryWalk })
      mw.beforeModelCall = append(mw.beforeModelCall, discoveryMw)
    }

    if (agent.permissions.rules?.length && !agent.permissions.no_rules_rules) {
      const permMw = createPermissionsMiddleware(agent.permissions)
      mw.beforeToolExecution = prepend(mw.beforeToolExecution, permMw)
    }

    if (ctx.memoryStore) {
      const memMw = createMemoryMiddleware({ store: ctx.memoryStore, injectLimit: agent.memory.injectLimit })
      mw.beforeLoopBegin = prepend(mw.beforeLoopBegin, memMw.beforeLoopBegin)
    }

    if (ctx.scratchpadStore) {
      const scratchpadMw = createScratchpadMiddleware(ctx.scratchpadStore)
      mw.beforeModelCall = append(mw.beforeModelCall, scratchpadMw)
    }

    ctx.middleware = mw
    ctx.logger.info('middleware rebuilt')
  }

  // ── Skills ──────────────────────────────────────────────────────
  const skillsChanged =
    JSON.stringify(agent.skillDirs) !== JSON.stringify(prev.agent.skillDirs)

  if (skillsChanged) {
    const resolvedSkillDirs = agent.skillDirs.map(d => resolvePath(d, app.configDir))
    ctx.skillIndex = await loadSkillIndex(resolvedSkillDirs, ctx.logger)
    ctx.logger.info('skills rebuilt', { skillCount: ctx.skillIndex.size })
  }

  // ── Context files ───────────────────────────────────────────────
  const contextChanged =
    JSON.stringify(agent.context) !== JSON.stringify(prev.agent.context)

  if (contextChanged && agent.context.enabled) {
    const contextFiles = await discoverContextFiles({ cwd: process.cwd(), patterns: agent.context.patterns })
    ctx.contextMessages = buildContextMessages(contextFiles)
    ctx.logger.info('context files rebuilt', { fileCount: contextFiles.length })
  }

  // ── Compaction model default ────────────────────────────────────
  if (!agent.compaction.model) {
    agent.compaction.model = getDefaultCompactionModel(agent.provider) || undefined
  }
  agent.compaction.onCompact = (info) => ctx.logger.info('context compacted', info)

  return true
}

/** Sanitize config for snapshot (mask secrets). */
function sanitizeConfigSnapshot(config: RaConfig): unknown {
  const copy = JSON.parse(JSON.stringify(config))
  if (copy.app?.providers) {
    for (const p of Object.values(copy.app.providers)) {
      if (p && typeof p === 'object' && 'apiKey' in (p as Record<string, unknown>)) {
        (p as Record<string, unknown>).apiKey = '***'
      }
    }
  }
  if (copy.app?.http?.token) copy.app.http.token = '***'
  return copy
}

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
  namespace: string
  sessionId: string
  resumed: boolean
  contextMessages: IMessage[]
  memoryStore: MemoryStore | undefined
  scratchpadStore: ScratchpadStore | undefined
  mcpClient: McpClient
  logger: Logger
  tracer: Tracer
  shutdown: () => Promise<void>
  /** Check config file mtime and rebuild derived state if changed. */
  refreshIfNeeded: () => Promise<boolean>
}

export async function bootstrap(
  config: RaConfig,
  opts: { resume?: string | true; skipSession?: boolean; configFilePath?: string; systemPromptPath?: string; loadOptions?: LoadConfigOptions },
): Promise<AppContext> {
  const { app, agent } = config

  // ── Paths derived from dataDir ───────────────────────────────────
  const { join } = await import('path')
  const storagePath = join(app.dataDir, 'sessions')
  const memoryPath = join(app.dataDir, 'memory.db')
  const namespace = configHandle(app.configDir)

  // ── Storage & session ──────────────────────────────────────────────
  // Storage is created before observability — logger will be set after createObservability()
  const storage = new SessionStorage(storagePath)
  await storage.init()

  const sessionOpts = {
    provider: agent.provider,
    model: agent.model,
    interface: app.interface,
    namespace,
    configDir: app.configDir,
  }

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
      const ensured = await storage.ensureSession(opts.resume, sessionOpts)
      sessionId = ensured.id
    }
    sessionDir = storage.sessionDir(sessionId)
    await mkdir(sessionDir, { recursive: true })
  } else {
    sessionId = (await storage.create(sessionOpts)).id
    sessionDir = storage.sessionDir(sessionId)
    await mkdir(sessionDir, { recursive: true })
  }

  // ── Observability ──────────────────────────────────────────────────
  const { logger, tracer } = createObservability({
    enabled: !opts.skipSession && (app.logsEnabled || app.tracesEnabled),
    logs: { enabled: app.logsEnabled, level: app.logLevel, output: 'session' },
    traces: { enabled: app.tracesEnabled, output: 'session' },
  }, { sessionId, sessionDir })

  storage.setLogger(logger)

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
  const middleware: Partial<MiddlewareConfig> = await loadMiddleware(config, app.configDir, logger)
  const userHookCount = Object.values(middleware).reduce((n, hooks) => n + (hooks?.length ?? 0), 0)
  if (userHookCount > 0) {
    logger.info('custom middleware loaded', { hookCount: userHookCount })
  }

  // Pattern resolvers (e.g. @file, url:) — collected here, combined with skill resolver below
  const patternResolvers = agent.context.resolvers?.length
    ? await loadResolvers(agent.context.resolvers, app.configDir)
    : []

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

  // Custom tools from file paths
  if (agent.tools.custom?.length) {
    const customToolSpan = tracer.startSpan('custom_tools.load', { fileCount: agent.tools.custom.length, files: agent.tools.custom })
    const customTools = await loadCustomTools(agent.tools.custom, app.configDir, logger)
    for (const tool of customTools) {
      const existing = tools.get(tool.name)
      if (existing) {
        logger.warn('custom tool overrides existing tool', { tool: tool.name })
      }
      tools.register(tool)
    }
    tracer.endSpan(customToolSpan, 'ok', { toolCount: customTools.length, tools: customTools.map(t => t.name) })
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
      logger,
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
  const resolvedSkillDirs = agent.skillDirs.map(d => resolvePath(d, app.configDir))
  const skillIndex = await loadSkillIndex(resolvedSkillDirs, logger)
  if (skillIndex.size > 0) {
    const availableXml = buildAvailableSkillsXml(skillIndex)
    const skillTokens = estimateTokens(availableXml)
    logger.info('skills indexed', {
      skillCount: skillIndex.size,
      skills: [...skillIndex.keys()],
      estimatedTokens: skillTokens,
    })

    patternResolvers.push(createSkillResolver(skillIndex))
  }

  // Register all pattern resolvers (user-configured + skill) as a single middleware
  if (patternResolvers.length > 0) {
    const resolverMw = createResolverMiddleware(patternResolvers, process.cwd())
    middleware.beforeModelCall = prepend(middleware.beforeModelCall, resolverMw)
  }

  // ── MCP clients ────────────────────────────────────────────────────
  const mcpClient = new McpClient()
  if (app.mcpServers?.length) {
    const mcpSpan = tracer.startSpan('mcp.connect', { serverCount: app.mcpServers.length })
    logger.info('connecting to MCP servers', { serverCount: app.mcpServers.length, servers: app.mcpServers.map(c => c.name) })
    const knownToolNames = new Set(tools.all().map(t => t.name))
    await mcpClient.connect(app.mcpServers, tools, { lazySchemas: app.mcpLazySchemas, logger })
    const mcpTools = tools.all().filter(t => !knownToolNames.has(t.name))
    const mcpToolTokens = estimateTokens(mcpTools)
    logger.info('MCP servers connected', {
      totalTools: tools.all().length,
      mcpToolCount: mcpTools.length,
      lazySchemas: app.mcpLazySchemas,
      estimatedMcpToolTokens: mcpToolTokens,
    })
    tracer.endSpan(mcpSpan, 'ok', {
      mcpToolCount: mcpTools.length,
      estimatedTokens: mcpToolTokens,
      lazySchemas: app.mcpLazySchemas,
    })
  }

  // ── Permissions middleware ─────────────────────────────────────────
  if (agent.permissions.rules?.length && !agent.permissions.no_rules_rules) {
    const permMw = createPermissionsMiddleware(agent.permissions)
    middleware.beforeToolExecution = prepend(middleware.beforeToolExecution, permMw)
    logger.info('permissions middleware loaded', { ruleCount: agent.permissions.rules.length })
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
      thinkingBudgetCap: agent.thinkingBudgetCap,
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

  // ── Handle snapshot (for inspector cross-handle views) ────────────
  {
    const snapshot = {
      config: sanitizeConfigSnapshot(config),
      context: {
        patterns: agent.context.patterns,
        files: contextFiles.map(f => ({ path: f.path, relativePath: f.relativePath, content: f.content })),
      },
      middleware: {
        hooks: Object.fromEntries(
          Object.entries(middleware)
            .filter(([, fns]) => fns && fns.length > 0)
            .map(([name, fns]) => [name, fns!.map(fn => fn.name || '(anonymous)')]),
        ),
        configMiddleware: agent.middleware,
      },
    }
    writeFile(join(app.dataDir, 'handle-snapshot.json'), JSON.stringify(snapshot, null, 2)).catch(() => {})
  }

  // ── Config hot-reload ──────────────────────────────────────────────
  const configManager = new ConfigManager(config, opts.configFilePath, opts.loadOptions ?? {})
  await configManager.init(opts.systemPromptPath)

  // ── Shutdown ───────────────────────────────────────────────────────
  const shutdown = async () => {
    logger.info('shutting down')
    try { await mcpClient.disconnect() } catch { /* best-effort */ }
    if (memoryStore) memoryStore.close()
    await logger.flush()
    await tracer.flush()
  }

  const ctx: AppContext = {
    config,
    provider,
    tools,
    middleware,
    skillIndex,
    storage,
    namespace,
    sessionId,
    resumed: !!opts.resume,
    contextMessages,
    memoryStore,
    scratchpadStore,
    mcpClient,
    logger,
    tracer,
    shutdown,
    refreshIfNeeded: async () => refreshAppContext(ctx, configManager),
  }

  return ctx
}

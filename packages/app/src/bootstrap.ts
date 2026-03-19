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
  type MiddlewareConfig,
  type IMessage,
  type IProvider,
  type Logger,
} from '@chinmaymk/ra'
import { createPermissionsMiddleware } from './agent/permissions'
import type { RaConfig } from './config/types'
import { discoverContextFiles, buildContextMessages, findGitRoot, createDiscoveryMiddleware } from './context'
import { createResolverMiddleware } from './context/resolve-middleware'
import { loadResolvers } from './context/resolver-loader'
import { McpClient } from './mcp/client'
import { MemoryStore, memorySearchTool, memorySaveTool, memoryForgetTool, createMemoryMiddleware } from './memory'
import { ScratchpadStore, scratchpadWriteTool, scratchpadDeleteTool, createScratchpadMiddleware } from './scratchpad'
import { loadMiddleware } from './middleware/loader'
import { createObservability } from './observability'
import { loadBuiltinSkills } from './skills/builtin'
import { loadSkills } from './skills/loader'
import type { Skill } from './skills/types'
import { SessionStorage } from './storage/sessions'
import { registerBuiltinTools, subagentTool } from './tools'
import { resolvePath } from './utils/paths'
import type { Tracer } from './observability/tracer'

export interface AppContext {
  config: RaConfig
  provider: IProvider
  tools: ToolRegistry
  middleware: Partial<MiddlewareConfig>
  skillMap: Map<string, Skill>
  storage: SessionStorage
  sessionId: string
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
  opts: { sessionId?: string; skipSession?: boolean },
): Promise<AppContext> {
  // ── Paths derived from dataDir ───────────────────────────────────
  const { join } = await import('path')
  const storagePath = join(config.dataDir, 'sessions')
  const memoryPath = join(config.dataDir, 'memory.db')

  // ── Storage & session ──────────────────────────────────────────────
  const storage = new SessionStorage(storagePath)
  await storage.init()

  let sessionId: string
  let sessionDir: string | undefined
  if (opts.skipSession) {
    sessionId = 'none'
  } else {
    sessionId = opts.sessionId ?? (await storage.create({
      provider: config.provider,
      model: config.model,
      interface: config.interface,
    })).id
    sessionDir = storage.sessionDir(sessionId)
    await mkdir(sessionDir, { recursive: true })
  }

  // ── Observability ──────────────────────────────────────────────────
  const { logger, tracer } = createObservability({
    enabled: !opts.skipSession && (config.logsEnabled || config.tracesEnabled),
    logs: { enabled: config.logsEnabled, level: config.logLevel, output: 'session' },
    traces: { enabled: config.tracesEnabled, output: 'session' },
  }, { sessionId, sessionDir })

  // ── Compaction model default ───────────────────────────────────────
  if (!config.compaction.model) {
    config.compaction.model = getDefaultCompactionModel(config.provider) || undefined
  }
  config.compaction.onCompact = (info) => logger.info('context compacted', info)

  // ── Context files ──────────────────────────────────────────────────
  const contextFiles = config.context.enabled
    ? await discoverContextFiles({ cwd: process.cwd(), patterns: config.context.patterns })
    : []
  const contextMessages = buildContextMessages(contextFiles)

  if (contextFiles.length > 0) {
    logger.info('context files discovered', {
      fileCount: contextFiles.length,
      patterns: config.context.patterns,
      files: contextFiles.map(f => f.relativePath),
    })
  }

  // ── Middleware ──────────────────────────────────────────────────────
  const middleware: Partial<MiddlewareConfig> = await loadMiddleware(config, config.configDir)
  const userHookCount = Object.values(middleware).reduce((n, hooks) => n + (hooks?.length ?? 0), 0)
  if (userHookCount > 0) {
    logger.info('custom middleware loaded', { hookCount: userHookCount })
  }

  // Pattern resolvers (e.g. @file, url:)
  if (config.context.resolvers?.length) {
    const resolvers = await loadResolvers(config.context.resolvers, config.configDir)
    if (resolvers.length > 0) {
      const resolverMw = createResolverMiddleware(resolvers, process.cwd())
      middleware.beforeModelCall = [resolverMw, ...(middleware.beforeModelCall ?? [])]
    }
  }

  // Dynamic context discovery — picks up context files from directories the agent touches
  if (config.context.enabled) {
    const root = (await findGitRoot(process.cwd())) ?? process.cwd()
    const discoveryMw = createDiscoveryMiddleware(config.context.patterns, root, new Set(contextFiles.map(f => f.path)))
    middleware.afterToolExecution = [...(middleware.afterToolExecution ?? []), discoveryMw]
  }

  // ── Provider ───────────────────────────────────────────────────────
  const provider = createProvider(buildProviderConfig(config.provider, config.providers[config.provider]))
  logger.info('provider initialized', { provider: config.provider, model: config.model })

  // ── Tools ──────────────────────────────────────────────────────────
  const tools = new ToolRegistry()
  if (config.tools.builtin || Object.keys(config.tools.overrides).length > 0) {
    registerBuiltinTools(tools, config.tools)
  }

  const toolNames = tools.all().map(t => t.name)
  if (toolNames.length > 0) {
    logger.info('tools registered', { toolCount: toolNames.length, tools: toolNames })
  }

  // ── Memory ─────────────────────────────────────────────────────────
  let memoryStore: MemoryStore | undefined
  if (config.memory.enabled) {
    memoryStore = new MemoryStore({
      path: memoryPath,
      maxMemories: config.memory.maxMemories,
      ttlDays: config.memory.ttlDays,
    })
    tools.register(memorySearchTool(memoryStore))
    tools.register(memorySaveTool(memoryStore))
    tools.register(memoryForgetTool(memoryStore))

    const memMw = createMemoryMiddleware({ store: memoryStore, injectLimit: config.memory.injectLimit })
    middleware.beforeLoopBegin = [memMw.beforeLoopBegin, ...(middleware.beforeLoopBegin ?? [])]
    logger.info('memory store initialized', { path: memoryPath, memoriesStored: memoryStore.count() })
  }

  // ── Scratchpad ───────────────────────────────────────────────────
  // Enabled by default when builtin tools are on; disable via tools.overrides.scratchpad.enabled: false
  const scratchpadEnabled =
    config.tools.overrides.scratchpad?.enabled !== false &&
    config.tools.builtin
  let scratchpadStore: ScratchpadStore | undefined
  if (scratchpadEnabled) {
    scratchpadStore = new ScratchpadStore()
    tools.register(scratchpadWriteTool(scratchpadStore))
    tools.register(scratchpadDeleteTool(scratchpadStore))

    const scratchpadMw = createScratchpadMiddleware(scratchpadStore)
    middleware.beforeModelCall = [...(middleware.beforeModelCall ?? []), scratchpadMw]
    logger.info('scratchpad initialized')
  }

  // ── Skills ─────────────────────────────────────────────────────────
  const resolvedSkillDirs = config.skillDirs.map(d => resolvePath(d, config.configDir))
  const skillMap = await loadSkills(resolvedSkillDirs)
  if (skillMap.size > 0) {
    logger.info('skills loaded', { skillCount: skillMap.size, skills: [...skillMap.keys()] })
  }

  const builtinSkills = loadBuiltinSkills(config.builtinSkills)
  for (const [name, skill] of builtinSkills) {
    if (!skillMap.has(name)) skillMap.set(name, skill)
  }

  // ── MCP clients ────────────────────────────────────────────────────
  const mcpClient = new McpClient()
  if (config.mcp.client?.length) {
    logger.info('connecting to MCP servers', { serverCount: config.mcp.client.length, servers: config.mcp.client.map(c => c.name) })
    await mcpClient.connect(config.mcp.client, tools, { lazySchemas: config.mcp.lazySchemas })
    logger.info('MCP servers connected', { totalTools: tools.all().length, lazySchemas: config.mcp.lazySchemas })
  }

  // ── Permissions middleware ─────────────────────────────────────────
  if (config.permissions.rules?.length && !config.permissions.no_rules_rules) {
    const permMw = createPermissionsMiddleware(config.permissions)
    middleware.beforeToolExecution = [permMw, ...(middleware.beforeToolExecution ?? [])]
    logger.info('permissions middleware loaded', { ruleCount: config.permissions.rules.length })
  }

  // ── Subagent tool (registered last — child registry built lazily) ──
  const agentSettings = config.tools.overrides.Agent ?? {}
  const agentEnabled = agentSettings.enabled !== false && config.tools.builtin
  if (agentEnabled) {
    const agentMaxConcurrency = (agentSettings.maxConcurrency as number | undefined) ?? config.maxConcurrency
    tools.register(subagentTool({
      provider,
      tools,
      model: config.model,
      systemPrompt: config.systemPrompt,
      middleware,
      thinking: config.thinking,
      compaction: config.compaction,
      toolTimeout: config.toolTimeout,
      maxIterations: config.maxIterations,
      maxConcurrency: agentMaxConcurrency,
      logger,
    }))
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
    skillMap,
    storage,
    sessionId,
    contextMessages,
    memoryStore,
    scratchpadStore,
    mcpClient,
    logger,
    tracer,
    shutdown,
  }
}

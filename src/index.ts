#!/usr/bin/env bun
import { loadConfig } from './config'
import { getDefaultCompactionModel } from './agent/model-registry'
import { discoverContextFiles, buildContextMessages } from './context'
import { createResolverMiddleware } from './context/resolve-middleware'
import { loadResolvers } from './context/resolver-loader'
import { loadMiddleware } from './middleware/loader'
import { createProvider, buildProviderConfig } from './providers/registry'
import { ToolRegistry } from './agent/tool-registry'
import { AgentLoop } from './agent/loop'
import { SessionStorage } from './storage/sessions'
import { loadSkills } from './skills/loader'
import { McpClient } from './mcp/client'
import { startMcpStdio, startMcpHttp } from './mcp/server'
import { runCli } from './interfaces/cli'
import { Repl } from './interfaces/repl'
import { HttpServer } from './interfaces/http'
import { parseArgs } from './interfaces/parse-args'
import { registerBuiltinTools } from './tools'
import { MemoryStore, memorySearchTool, memorySaveTool, memoryForgetTool, createMemoryMiddleware } from './memory'
import { join } from 'path'

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf-8').trim()
  return text || undefined
}

const HELP = `
ra - AI agent CLI

USAGE
  ra [options] [prompt]

OPTIONS
  --provider <name>                   Provider (anthropic, openai, google, ollama)
  --model <name>                      Model name
  --system-prompt <text>              System prompt text or path to file
  --max-iterations <n>                Max agent loop iterations
  --config <path>                     Path to config file
  --skill <name>                      Skill to activate for this run (repeatable)
  --skill-dir <path>                  Directory to load skills from (repeatable)
  --file <path>                       File to attach (repeatable)
  --resume <session-id>               Resume a previous session

INTERFACE
  --cli                               Oneshot mode: run prompt and exit
  --repl                              Interactive REPL mode (default)
  --http                              Start HTTP API server
  --mcp                               Start MCP HTTP server (default port: 3001)
  --mcp-stdio                         Start MCP stdio server (for Claude Desktop/Cursor)

HTTP SERVER
  --http-port <port>                  HTTP server port (default: 3000)
  --http-token <token>                Bearer token for HTTP auth

MCP SERVER
  --mcp-server-enabled                Enable MCP HTTP server alongside main interface
  --mcp-server-port <port>            MCP server port (default: 3001)
  --mcp-server-tool-name <name>       MCP tool name
  --mcp-server-tool-description <d>   MCP tool description

MEMORY
  --memory                            Enable persistent memory across conversations
  --list-memories                     List all stored memories
  --memories <query>                  Search memories by keyword
  --forget <query>                    Forget memories matching query

STORAGE
  --storage-path <path>               Session storage directory
  --storage-max-sessions <n>          Max stored sessions
  --storage-ttl-days <n>              Session TTL in days

THINKING
  --thinking <level>                  Enable extended thinking: low | medium | high

PROVIDER OPTIONS
  --anthropic-base-url <url>          Anthropic API base URL
  --openai-base-url <url>             OpenAI API base URL
  --ollama-host <url>                 Ollama host URL

  --builtin-tools                     Enable built-in tools (filesystem, shell, network)
  --show-context                      Show discovered context files and exit
  --exec <script>                     Execute a JS/TS file and exit
  --help, -h                          Print this help message

SKILL MANAGEMENT
  ra skill install <source>           Install skill from npm, GitHub, or URL
  ra skill remove <name>              Remove an installed skill
  ra skill list                       List installed skills

  Sources:
    ra skill install code-review             npm package "code-review"
    ra skill install npm:ra-skill-lint@1.0   npm with version
    ra skill install github:user/repo        GitHub repository
    ra skill install https://example.com/s.tgz  URL tarball

ENV VARS
  RA_PROVIDER, RA_MODEL, RA_INTERFACE, RA_SYSTEM_PROMPT, RA_MAX_ITERATIONS
  RA_HTTP_PORT, RA_HTTP_TOKEN
  RA_MCP_SERVER_ENABLED, RA_MCP_SERVER_PORT
  RA_MCP_SERVER_TOOL_NAME, RA_MCP_SERVER_TOOL_DESCRIPTION
  RA_STORAGE_PATH, RA_STORAGE_MAX_SESSIONS, RA_STORAGE_TTL_DAYS
  RA_SKILL_DIRS=dir1,dir2  RA_SKILLS=skill1,skill2
  RA_ANTHROPIC_API_KEY, RA_ANTHROPIC_BASE_URL
  RA_OPENAI_API_KEY, RA_OPENAI_BASE_URL
  RA_GOOGLE_API_KEY, RA_OLLAMA_HOST
  RA_BUILTIN_TOOLS
  RA_THINKING
  RA_MEMORY_ENABLED, RA_MEMORY_PATH, RA_MEMORY_MAX_MEMORIES
  RA_MEMORY_TTL_DAYS, RA_MEMORY_INJECT_LIMIT

STDIN
  When input is piped, ra reads stdin and auto-switches to CLI mode.
  If a prompt argument is given, the prompt comes first followed by stdin.
  If no prompt argument, stdin becomes the prompt.

EXAMPLES
  ra "What is the capital of France?"
  ra --provider openai --model gpt-4o "Summarize this file" --file report.pdf
  cat file.ts | ra "review this code"
  git diff | ra "summarize these changes"
  echo "hello" | ra
  ra --repl
  ra --http --http-port 8080
  ra --mcp --mcp-server-port 4000
  ra --mcp-stdio
  ra --mcp-server-enabled --mcp-server-port 4000 --repl
`.trim()


async function execScript(scriptPath: string): Promise<void> {
  const resolved = require('path').resolve(scriptPath)
  const mod = await import(resolved)
  if (typeof mod.default === 'function') {
    const result = await mod.default()
    if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result))
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  if (parsed.meta.exec) {
    await execScript(parsed.meta.exec)
    process.exit(0)
  }

  if (parsed.meta.help) {
    console.log(HELP)
    process.exit(0)
  }

  // Handle skill management subcommands (lazy-load registry module)
  if (parsed.meta.skillCommand) {
    const { installSkill, removeSkill, listInstalledSkills, defaultSkillInstallDir } = await import('./skills/registry')
    const { action, args } = parsed.meta.skillCommand
    switch (action) {
      case 'install': {
        if (args.length === 0) {
          console.error('Usage: ra skill install <source>')
          process.exit(1)
        }
        for (const source of args) {
          try {
            const installed = await installSkill(source)
            console.log(`Installed skills: ${installed.join(', ')} → ${defaultSkillInstallDir()}`)
          } catch (err) {
            console.error(`Failed to install "${source}": ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        }
        process.exit(0)
      }
      case 'remove': {
        if (args.length === 0) {
          console.error('Usage: ra skill remove <name>')
          process.exit(1)
        }
        for (const name of args) {
          try {
            await removeSkill(name)
            console.log(`Removed skill: ${name}`)
          } catch (err) {
            console.error(`Failed to remove "${name}": ${err instanceof Error ? err.message : String(err)}`)
            process.exit(1)
          }
        }
        process.exit(0)
      }
      case 'list': {
        const skills = await listInstalledSkills()
        if (skills.length === 0) {
          console.log(`No skills installed in ${defaultSkillInstallDir()}`)
        } else {
          for (const s of skills) {
            const src = s.source
              ? ` (${s.source.registry}${s.source.package ? ': ' + s.source.package : ''}${s.source.repo ? ': ' + s.source.repo : ''}${s.source.version ? '@' + s.source.version : ''})`
              : ''
            console.log(`  ${s.name}${src}`)
          }
        }
        process.exit(0)
      }
    }
  }

  // Read piped stdin only for CLI/unspecified mode (http/repl/mcp manage stdin themselves)
  const isNonCliInterface = parsed.config.interface && parsed.config.interface !== 'cli'
  const stdinContent = isNonCliInterface ? undefined : await readStdin()
  if (stdinContent) {
    parsed.meta.prompt = parsed.meta.prompt
      ? `${parsed.meta.prompt}\n\n${stdinContent}`
      : stdinContent
    parsed.config.interface = 'cli' as const
  }

  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: parsed.meta.configPath,
    cliArgs: parsed.config,
    env: process.env as Record<string, string | undefined>,
  })

  // Resolve compaction model default from provider if not set
  if (!config.compaction.model) {
    config.compaction.model = getDefaultCompactionModel(config.provider) || undefined
  }

  // Discover project context files
  const contextMessages = config.context.enabled
    ? buildContextMessages(await discoverContextFiles({
        cwd: process.cwd(),
        patterns: config.context.patterns,
      }))
    : []

  const middleware = await loadMiddleware(config, process.cwd())

  // Set up pattern resolvers (e.g. @file, url:)
  if (config.context.resolvers?.length) {
    const resolvers = await loadResolvers(config.context.resolvers, process.cwd())
    if (resolvers.length > 0) {
      const resolverMw = createResolverMiddleware(resolvers, process.cwd())
      middleware.beforeModelCall = [resolverMw, ...(middleware.beforeModelCall ?? [])]
    }
  }

  // Create provider
  const provider = createProvider(buildProviderConfig(config.provider, config.providers[config.provider]))

  // Create tool registry
  const tools = new ToolRegistry()

  if (config.builtinTools) {
    registerBuiltinTools(tools)
  }

  // Set up memory system
  let memoryStore: MemoryStore | undefined
  if (config.memory.enabled) {
    const memoryPath = config.memory.path.startsWith('/')
      ? config.memory.path
      : join(process.cwd(), config.memory.path)
    memoryStore = new MemoryStore({
      path: memoryPath,
      maxMemories: config.memory.maxMemories,
      ttlDays: config.memory.ttlDays,
    })
    tools.register(memorySearchTool(memoryStore))
    tools.register(memorySaveTool(memoryStore))
    tools.register(memoryForgetTool(memoryStore))

    const memMw = createMemoryMiddleware({
      store: memoryStore,
      injectLimit: config.memory.injectLimit,
    })
    middleware.beforeLoopBegin = [memMw.beforeLoopBegin, ...(middleware.beforeLoopBegin ?? [])]
  }

  // Create session storage
  const storagePath = config.storage.path.startsWith('/')
    ? config.storage.path
    : join(process.cwd(), config.storage.path)
  const storage = new SessionStorage(storagePath)
  await storage.init()

  // Load skills from configured directories
  const skillMap = await loadSkills(config.skillDirs)

  // Active skills for this run (always-on from config + per-run --skill flags)
  const activeSkills = [...config.skills, ...parsed.meta.skills]

  // Connect MCP clients
  const mcpClient = new McpClient()
  if (config.mcp.client && config.mcp.client.length > 0) {
    await mcpClient.connect(config.mcp.client, tools)
  }

  // Agent handler shared by MCP transports
  const mcpHandler = async (input: unknown) => {
    const loop = new AgentLoop({ provider, tools, model: config.model, maxIterations: config.maxIterations, toolTimeout: config.toolTimeout, middleware, compaction: config.compaction })
    const prompt = typeof input === 'string' ? input : JSON.stringify(input)
    const result = await loop.run([{ role: 'user', content: prompt }])
    const last = result.messages.at(-1)
    return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)
  }

  // Start MCP HTTP server if configured (via --mcp-server-enabled alongside another interface)
  let stopMcpHttp: (() => Promise<void>) | null = null
  if (config.interface !== 'mcp' && config.mcp.server?.enabled) {
    stopMcpHttp = await startMcpHttp(config.mcp.server, mcpHandler, config.builtinTools ? tools : undefined)
    console.error(`MCP server (http) listening on port ${config.mcp.server.port}`)
  }

  // Shutdown helpers
  const shutdown = async () => {
    try { await mcpClient.disconnect() } catch { /* best-effort cleanup */ }
    try { if (stopMcpHttp) await stopMcpHttp() } catch { /* best-effort cleanup */ }
    if (memoryStore) memoryStore.close()
  }

  process.on('SIGINT', async () => { await shutdown(); process.exit(0) })
  process.on('SIGTERM', async () => { await shutdown(); process.exit(0) })

  if (parsed.meta.showContext) {
    if (contextMessages.length === 0) {
      console.log('No context files discovered.')
    } else {
      for (const msg of contextMessages) {
        const content = typeof msg.content === 'string' ? msg.content : ''
        console.log(content)
        console.log()
      }
    }
    await shutdown()
    process.exit(0)
  }

  if (parsed.meta.listMemories || parsed.meta.memories !== undefined) {
    if (!memoryStore) {
      console.log('Memory is not enabled. Use --memory or set memory.enabled in config.')
    } else {
      const query = parsed.meta.memories || ''
      const memories = query ? memoryStore.search(query, 100) : memoryStore.list(100)
      if (memories.length === 0) {
        console.log(query ? 'No matching memories found.' : 'No memories stored.')
      } else {
        const total = memoryStore.count()
        console.log(query
          ? `${memories.length} matching memories (${total} total):\n`
          : `${memories.length} memories (${total} total):\n`)
        for (const m of memories) {
          console.log(`  [${m.id}] [${m.tags || 'general'}] ${m.content}`)
        }
      }
    }
    await shutdown()
    process.exit(0)
  }

  if (parsed.meta.forget !== undefined) {
    if (!memoryStore) {
      console.log('Memory is not enabled. Use --memory or set memory.enabled in config.')
    } else {
      const query = parsed.meta.forget
      if (!query) {
        console.log('Usage: ra --forget "search query"')
      } else {
        const deleted = memoryStore.forget(query, 1000)
        console.log(deleted > 0 ? `Forgot ${deleted} memory(s).` : 'No matching memories found.')
      }
    }
    await shutdown()
    process.exit(0)
  }

  // Determine which interface to launch
  if (config.interface === 'mcp') {
    stopMcpHttp = await startMcpHttp(config.mcp.server, mcpHandler, config.builtinTools ? tools : undefined)
    console.error(`MCP server (http) listening on port ${config.mcp.server.port}`)
    await new Promise(() => {})
  } else if (config.interface === 'mcp-stdio') {
    const isDevMode = /\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? '')
    const mcpCommand = isDevMode ? 'bun' : process.argv[0]!
    const mcpArgs = isDevMode ? [process.argv[1]!, '--mcp-stdio'] : ['--mcp-stdio']
    const mcpConfig = JSON.stringify({
      mcpServers: { ra: { command: mcpCommand, args: mcpArgs } }
    }, null, 2)
    process.stderr.write(
      `MCP stdio server starting.\n\n` +
      `Cursor — .cursor/mcp.json:\n${mcpConfig}\n\n` +
      `Claude Desktop — ~/Library/Application Support/Claude/claude_desktop_config.json:\n${mcpConfig}\n\n`
    )
    await startMcpStdio(config.mcp.server, mcpHandler, config.builtinTools ? tools : undefined)
    await shutdown()
    return
  } else if (config.interface === 'cli' || (parsed.meta.prompt && !parsed.config.interface)) {
    if (!parsed.meta.prompt) {
      console.error('Error: --cli requires a prompt argument')
      process.exit(1)
    }
    const sessionMessages = parsed.meta.resume ? await storage.readMessages(parsed.meta.resume) : []
    const cliResult = await runCli({
      prompt: parsed.meta.prompt,
      files: parsed.meta.files,
      skills: activeSkills,
      systemPrompt: config.systemPrompt,
      model: config.model,
      provider,
      tools,
      skillMap,
      maxIterations: config.maxIterations,
      middleware,
      thinking: config.thinking,
      compaction: config.compaction,
      contextMessages,
      sessionMessages,
    })
    if (parsed.meta.resume) {
      for (const msg of cliResult.messages.slice(cliResult.priorCount)) {
        await storage.appendMessage(parsed.meta.resume, msg)
      }
    }
    process.stdout.write('\n')
    await shutdown()
  } else if (config.interface === 'http') {
    const httpServer = new HttpServer({
      port: config.http.port,
      token: config.http.token || undefined,
      model: config.model,
      provider,
      tools,
      storage,
      systemPrompt: config.systemPrompt,
      skillMap,
      maxIterations: config.maxIterations,
      toolTimeout: config.toolTimeout,
      middleware,
      thinking: config.thinking,
      compaction: config.compaction,
      contextMessages,
    })
    await httpServer.start()
    console.error(`HTTP server listening on port ${httpServer.port}`)
    // Keep process alive; clean up on signal
    const httpShutdown = async () => { try { await httpServer.stop() } catch { /* best-effort */ } await shutdown() }
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    process.on('SIGINT', async () => { await httpShutdown(); process.exit(0) })
    process.on('SIGTERM', async () => { await httpShutdown(); process.exit(0) })
    await new Promise(() => {})
  } else {
    const repl = new Repl({
      model: config.model,
      provider,
      tools,
      storage,
      systemPrompt: config.systemPrompt,
      skillMap,
      maxIterations: config.maxIterations,
      toolTimeout: config.toolTimeout,
      sessionId: parsed.meta.resume,
      middleware,
      thinking: config.thinking,
      compaction: config.compaction,
      contextMessages,
      memoryStore,
    })
    await repl.start()
    await shutdown()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

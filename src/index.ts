#!/usr/bin/env bun
import { loadConfig } from './config'
import { discoverContextFiles, buildContextMessages } from './context'
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

  --exec <script>                     Execute a JS/TS file and exit
  --help, -h                          Print this help message

SUBCOMMANDS
  skill install <github-url>          Install skills from a GitHub repository
                                      URL formats: owner/repo, github.com/owner/repo
                                      Optional ref: owner/repo@v2

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
  RA_THINKING

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

  if (parsed.meta.subcommand?.name === 'skill') {
    const { installSkillsFromGithub } = await import('./skills/install')
    const args = parsed.meta.subcommand.args
    if (args[0] === 'install' && args[1]) {
      const config = await loadConfig({ cwd: process.cwd(), env: process.env as Record<string, string | undefined> })
      const targetDir = config.skillDirs[0] || join(process.cwd(), 'skills')
      console.log(`Installing skills from ${args[1]} into ${targetDir}...`)
      const installed = await installSkillsFromGithub(args[1], targetDir)
      if (installed.length === 0) {
        console.log('No valid skills found.')
      } else {
        console.log(`Installed ${installed.length} skill(s): ${installed.join(', ')}`)
      }
    } else {
      console.log('Usage: ra skill install <github-url>')
    }
    process.exit(0)
  }

  // Read piped stdin only for CLI/unspecified mode (http/repl/mcp manage stdin themselves)
  const isNonCliInterface = parsed.config.interface && parsed.config.interface !== 'cli'
  const stdinContent = isNonCliInterface ? undefined : await readStdin()
  if (stdinContent) {
    // Merge: prompt first, then stdin content
    parsed.meta.prompt = parsed.meta.prompt
      ? `${parsed.meta.prompt}\n\n${stdinContent}`
      : stdinContent
    // Force CLI mode when piping
    parsed.config.interface = 'cli' as const
  }

  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: parsed.meta.configPath,
    cliArgs: parsed.config,
    env: process.env as Record<string, string | undefined>,
  })

  // Discover project context files
  const contextMessages = config.context.enabled
    ? buildContextMessages(await discoverContextFiles({
        cwd: process.cwd(),
        patterns: config.context.patterns,
      }))
    : []

  const middleware = await loadMiddleware(config, process.cwd())

  // Create provider
  const provider = createProvider(buildProviderConfig(config.provider, config.providers[config.provider]))

  // Create tool registry
  const tools = new ToolRegistry()

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
    stopMcpHttp = await startMcpHttp(config.mcp.server, mcpHandler)
    console.error(`MCP server (http) listening on port ${config.mcp.server.port}`)
  }

  // Shutdown helpers
  const shutdown = async () => {
    await mcpClient.disconnect()
    if (stopMcpHttp) await stopMcpHttp()
  }

  process.on('SIGINT', async () => { await shutdown(); process.exit(0) })
  process.on('SIGTERM', async () => { await shutdown(); process.exit(0) })

  // Determine which interface to launch
  if (config.interface === 'mcp') {
    stopMcpHttp = await startMcpHttp(config.mcp.server, mcpHandler)
    console.error(`MCP server (http) listening on port ${config.mcp.server.port}`)
    // Keep process alive
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
    await startMcpStdio(config.mcp.server, mcpHandler)
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
    })
    await httpServer.start()
    console.error(`HTTP server listening on port ${httpServer.port}`)
    // Keep process alive; clean up on signal
    const httpShutdown = async () => { await httpServer.stop(); await shutdown() }
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    process.on('SIGINT', async () => { await httpShutdown(); process.exit(0) })
    process.on('SIGTERM', async () => { await httpShutdown(); process.exit(0) })
    await new Promise(() => {}) // keep alive
  } else {
    // Default: interactive REPL mode
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
    })
    await repl.start()
    await shutdown()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

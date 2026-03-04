import { loadConfig } from './config'
import type { RaConfig } from './config'
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
  --skill <name>                      Skill to activate (repeatable)
  --file <path>                       File to attach (repeatable)
  --resume <session-id>               Resume a previous session

INTERFACE
  --cli                               Oneshot mode: run prompt and exit
  --repl                              Interactive REPL mode (default)
  --http                              Start HTTP API server
  --mcp                               Start MCP stdio server

HTTP SERVER
  --http-port <port>                  HTTP server port (default: 3000)
  --http-token <token>                Bearer token for HTTP auth

MCP SERVER
  --mcp-server-enabled                Enable MCP HTTP server alongside main interface
  --mcp-server-port <port>            MCP HTTP server port (default: 3001)
  --mcp-server-transport <t>          MCP server transport: stdio | http
  --mcp-server-tool-name <name>       MCP tool name
  --mcp-server-tool-description <d>   MCP tool description

STORAGE
  --storage-path <path>               Session storage directory
  --storage-max-sessions <n>          Max stored sessions
  --storage-ttl-days <n>              Session TTL in days

PROVIDER OPTIONS
  --anthropic-base-url <url>          Anthropic API base URL
  --openai-base-url <url>             OpenAI API base URL
  --ollama-host <url>                 Ollama host URL

  --help, -h                          Print this help message

ENV VARS
  RA_PROVIDER, RA_MODEL, RA_INTERFACE, RA_SYSTEM_PROMPT, RA_MAX_ITERATIONS
  RA_HTTP_PORT, RA_HTTP_TOKEN
  RA_MCP_SERVER_ENABLED, RA_MCP_SERVER_PORT, RA_MCP_SERVER_TRANSPORT
  RA_MCP_SERVER_TOOL_NAME, RA_MCP_SERVER_TOOL_DESCRIPTION
  RA_STORAGE_PATH, RA_STORAGE_MAX_SESSIONS, RA_STORAGE_TTL_DAYS
  RA_ANTHROPIC_API_KEY, RA_ANTHROPIC_BASE_URL
  RA_OPENAI_API_KEY, RA_OPENAI_BASE_URL
  RA_GOOGLE_API_KEY, RA_OLLAMA_HOST

EXAMPLES
  ra "What is the capital of France?"
  ra --provider openai --model gpt-4o "Summarize this file" --file report.pdf
  ra --repl
  ra --http --http-port 8080
  ra --mcp-server-enabled --mcp-server-port 4000 --repl
`.trim()


async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  if (parsed.meta.help) {
    console.log(HELP)
    process.exit(0)
  }

  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: parsed.meta.configPath,
    cliArgs: parsed.config,
    env: process.env as Record<string, string | undefined>,
  })

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

  // Load skills
  const skillMap = await loadSkills(config.skills)

  // Active skills for this run (from --skill flags + alwaysLoad)
  const activeSkills = [
    ...(config.alwaysLoad ?? []),
    ...parsed.meta.skills,
  ]

  // Connect MCP clients
  const mcpClient = new McpClient()
  if (config.mcp.client && config.mcp.client.length > 0) {
    await mcpClient.connect(config.mcp.client, tools)
  }

  // Agent handler shared by MCP transports
  const mcpHandler = async (input: unknown) => {
    const loop = new AgentLoop({ provider, tools, model: config.model, maxIterations: config.maxIterations })
    const prompt = typeof input === 'string' ? input : JSON.stringify(input)
    const result = await loop.run([{ role: 'user', content: prompt }])
    const last = result.messages.at(-1)
    return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)
  }

  // Start MCP HTTP server if configured
  let stopMcpHttp: (() => Promise<void>) | null = null
  if (config.mcp.server?.enabled && config.mcp.server.transport === 'http') {
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
    const isDevMode = /\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? '')
    const mcpCommand = isDevMode ? 'bun' : process.argv[0]!
    const mcpArgs = isDevMode ? [process.argv[1]!, '--mcp'] : ['--mcp']
    const cursorConfig = JSON.stringify({
      mcpServers: { ra: { command: mcpCommand, args: mcpArgs } }
    }, null, 2)
    process.stderr.write(`MCP stdio server starting. Add to .cursor/mcp.json:\n\n${cursorConfig}\n\n`)
    await startMcpStdio(config.mcp.server, mcpHandler)
    await shutdown()
    return
  } else if (config.interface === 'cli' || parsed.meta.prompt) {
    if (!parsed.meta.prompt) {
      console.error('Error: --cli requires a prompt argument')
      process.exit(1)
    }
    await runCli({
      prompt: parsed.meta.prompt,
      files: parsed.meta.files,
      skills: activeSkills,
      systemPrompt: config.systemPrompt,
      model: config.model,
      provider,
      tools,
      skillMap,
      maxIterations: config.maxIterations,
    })
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
    })
    await httpServer.start()
    console.error(`HTTP server listening on port ${config.http.port}`)
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
      sessionId: parsed.meta.resume,
    })
    await repl.start()
    await shutdown()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

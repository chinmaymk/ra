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
import { c } from './interfaces/tui'
import { HttpServer } from './interfaces/http'
import { parseArgs } from './interfaces/parse-args'
import { join } from 'path'

const HELP = `
ra - AI agent CLI

USAGE
  ra [options] [prompt]

OPTIONS
  --provider <name>       Provider to use (anthropic, openai, google, ollama)
  --model <name>          Model name
  --config <path>         Path to config file
  --skill <name>          Skill to load (repeatable)
  --file <path>           File to attach (repeatable)
  --system-prompt <text>  System prompt text or path to file
  --resume <session-id>   Resume a previous session
  --http                  Start HTTP server
  --repl                  Start interactive REPL (default)
  --mcp                   Start MCP stdio server
  --help                  Print this help message

ARGUMENTS
  prompt                  Prompt to run (non-interactive mode)

EXAMPLES
  ra "What is the capital of France?"
  ra --provider openai --model gpt-4o "Summarize this file" --file report.pdf
  ra --interface http
  ra serve
`.trim()


async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  if (parsed.help) {
    console.log(HELP)
    process.exit(0)
  }

  const cliArgs: Partial<RaConfig> = {
    ...(parsed.provider && { provider: parsed.provider as RaConfig['provider'] }),
    ...(parsed.model && { model: parsed.model }),
    ...(parsed.systemPrompt && { systemPrompt: parsed.systemPrompt }),
  }

  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: parsed.config,
    cliArgs,
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
    ...parsed.skills,
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
  if (parsed.mcp) {
    // Stdio MCP server — blocks until stdin closes
    await startMcpStdio(config.mcp.server, mcpHandler)
    await shutdown()
    return
  } else if (parsed.cli || parsed.prompt) {
    // Non-interactive oneshot CLI mode
    if (!parsed.prompt) {
      console.error('Error: --cli requires a prompt argument')
      process.exit(1)
    }
    process.stdout.write(`${c.cyan}${c.bold}ra ›${c.reset} `)
    await runCli({
      prompt: parsed.prompt,
      files: parsed.files,
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
  } else if (parsed.http) {
    // HTTP server mode
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
    // Interactive REPL mode
    const repl = new Repl({
      model: config.model,
      provider,
      tools,
      storage,
      systemPrompt: config.systemPrompt,
      skillMap,
      maxIterations: config.maxIterations,
      sessionId: parsed.resume,
      onChunk: (text) => process.stdout.write(text),
      onStatus: (msg) => console.error(msg),
    })
    await repl.start()
    await shutdown()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

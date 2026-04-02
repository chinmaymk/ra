#!/usr/bin/env bun
import { errorMessage } from '@chinmaymk/ra'
import { loadConfig } from './config'
import type { RaConfig } from './config/types'
import { bootstrap, type AppContext } from './bootstrap'
import { parseArgs } from './interfaces/parse-args'
import { HELP } from './interfaces/help'
import { runExecScript, runSubCommand, showContext, runMemoryCommand, showConfig } from './interfaces/commands'
import {
  onSignals,
  launchCli,
  launchRepl,
  launchHttp,
  launchMcpHttp,
  launchMcpStdio,
  launchCron,
  launchInspector,
} from './interfaces/launchers'

// ── Helpers ──────────────────────────────────────────────────────────

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf-8').trim()
  return text || undefined
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
  if (parsed.meta.subCommand) {
    await runSubCommand(parsed.meta.subCommand)
  }
}

// ── Standalone commands (need bootstrap but no interface) ────────────

async function handleStandaloneCommands(
  parsed: ReturnType<typeof parseArgs>,
  app: AppContext,
): Promise<void> {
  const { listMemories, memories, forget } = parsed.meta
  if (listMemories || memories !== undefined) {
    runMemoryCommand(app.memoryStore, { list: listMemories, search: memories })
  } else if (forget !== undefined) {
    runMemoryCommand(app.memoryStore, { forget })
  } else {
    return
  }
  await app.shutdown()
  process.exit(0)
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  await handleEarlyExits(parsed)

  // Ensure parsed.config.app exists for interface assignment
  const parsedApp = (parsed.config.app ??= {} as Partial<RaConfig>['app'] & Record<string, unknown>) as Partial<RaConfig['app']>

  // Read piped stdin (only for CLI / unspecified mode)
  const isNonCliInterface = parsedApp.interface && parsedApp.interface !== 'cli'
  if (!isNonCliInterface) {
    const stdinContent = await readStdin()
    if (stdinContent) {
      parsed.meta.prompt = parsed.meta.prompt
        ? `${parsed.meta.prompt}\n\n${stdinContent}`
        : stdinContent
      parsedApp.interface = 'cli' as const
    }
  }

  // Infer CLI mode when a prompt is given without an explicit interface flag
  if (parsed.meta.prompt && !parsedApp.interface) {
    parsedApp.interface = 'cli' as const
  }

  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: parsed.meta.configPath,
    cliArgs: parsed.config,
    env: process.env as Record<string, string | undefined>,
    recipeName: parsed.meta.recipeName,
  })

  if (parsed.meta.showConfig || parsed.meta.showContext) {
    const { discoverContextFiles, buildContextMessages } = await import('./context')
    const contextFiles = config.agent.context.enabled
      ? await discoverContextFiles({ cwd: process.cwd(), patterns: config.agent.context.patterns })
      : []

    if (parsed.meta.showConfig) {
      showConfig(config, contextFiles.map(f => f.relativePath))
    }
    if (parsed.meta.showContext) {
      showContext(buildContextMessages(contextFiles))
    }
    process.exit(0)
  }

  const isInspector = config.app.interface === 'inspector'
  const app = await bootstrap(config, { resume: parsed.meta.resume, skipSession: isInspector })

  const signals = onSignals(app.shutdown)
  if (!isInspector) await handleStandaloneCommands(parsed, app)

  app.logger.info('starting interface', { interface: config.app.interface })

  switch (config.app.interface) {
    case 'mcp':       return launchMcpHttp(app)
    case 'mcp-stdio': return launchMcpStdio(app)
    case 'http':      return launchHttp(app, signals, onSignals)
    case 'inspector': return launchInspector(app)
    case 'cron':      return launchCron(app, parsed.meta.runImmediately)
    case 'cli':       return launchCli(parsed, app)
    default:          return launchRepl(app)
  }
}

main().catch((err) => {
  console.error(errorMessage(err))
  process.exit(1)
})

#!/usr/bin/env bun
import { loadConfig } from './config'
import { bootstrap, type AppContext } from './bootstrap'
import { parseArgs } from './interfaces/parse-args'
import { errorMessage } from './utils/errors'
import { HELP, BUNDLE_HELP } from './interfaces/help'
import { runExecScript, runSkillCommand, showContext, runMemoryCommand } from './interfaces/commands'
import { readStdin, run } from './run'

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
  if (parsed.meta.bundleCommand) {
    if (parsed.meta.help || !parsed.meta.bundleCommand.output) {
      console.log(BUNDLE_HELP)
      process.exit(0)
    }
    const { bundle } = await import('./bundle')
    await bundle({
      output: parsed.meta.bundleCommand.output,
      name: parsed.meta.bundleCommand.name,
      configPath: parsed.meta.bundleCommand.configPath,
    })
    process.exit(0)
  }
  if (parsed.meta.help) {
    console.log(HELP)
    process.exit(0)
  }
  if (parsed.meta.skillCommand) {
    await runSkillCommand(parsed.meta.skillCommand)
  }
}

// ── Standalone commands (need bootstrap but no interface) ────────────

async function handleStandaloneCommands(
  parsed: ReturnType<typeof parseArgs>,
  app: AppContext,
): Promise<void> {
  if (parsed.meta.showContext) {
    showContext(app.contextMessages)
    await app.shutdown()
    process.exit(0)
  }

  if (parsed.meta.listMemories || parsed.meta.memories !== undefined) {
    runMemoryCommand(app.memoryStore, { list: parsed.meta.listMemories, search: parsed.meta.memories })
    await app.shutdown()
    process.exit(0)
  }

  if (parsed.meta.forget !== undefined) {
    runMemoryCommand(app.memoryStore, { forget: parsed.meta.forget })
    await app.shutdown()
    process.exit(0)
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  await handleEarlyExits(parsed)

  // Read piped stdin (only for CLI / unspecified mode)
  const isNonCliInterface = parsed.config.interface && parsed.config.interface !== 'cli'
  if (!isNonCliInterface) {
    const stdinContent = await readStdin()
    if (stdinContent) {
      parsed.meta.prompt = parsed.meta.prompt
        ? `${parsed.meta.prompt}\n\n${stdinContent}`
        : stdinContent
      parsed.config.interface = 'cli' as const
    }
  }

  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: parsed.meta.configPath,
    cliArgs: parsed.config,
    env: process.env as Record<string, string | undefined>,
  })

  const app = await bootstrap(config, { sessionId: parsed.meta.resume })

  await handleStandaloneCommands(parsed, app)

  await run(parsed, app)
}

main().catch((err) => {
  console.error(errorMessage(err))
  process.exit(1)
})

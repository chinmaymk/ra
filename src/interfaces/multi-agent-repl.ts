/**
 * Multi-agent REPL — one Repl instance, swaps backing context on /agent switch.
 */
import readline from 'readline'
import { errorMessage } from '../utils/errors'
import { Repl, type ReplOptions, type ReplAgentState } from './repl'
import type { MultiAgentContext } from '../multi-agent'
import * as tui from './tui'

export class MultiAgentRepl {
  private ctx: MultiAgentContext
  private currentAgent: string
  private repl: Repl
  private agentStates = new Map<string, ReplAgentState>()
  private agentOptions = new Map<string, ReplOptions>()

  constructor(ctx: MultiAgentContext) {
    this.ctx = ctx
    this.currentAgent = ctx.defaultAgent

    // Build ReplOptions and initial state for each agent
    for (const [name, app] of ctx.agents) {
      this.agentOptions.set(name, {
        model: app.config.model,
        provider: app.provider,
        tools: app.tools,
        storage: app.storage,
        systemPrompt: app.config.systemPrompt,
        skillMap: app.skillMap,
        maxIterations: app.config.maxIterations,
        toolTimeout: app.config.toolTimeout,
        sessionId: app.sessionId,
        middleware: app.middleware,
        thinking: app.config.thinking,
        compaction: app.config.compaction,
        contextMessages: app.contextMessages,
        memoryStore: app.memoryStore,
      })
      this.agentStates.set(name, {
        messages: [],
        sessionId: app.sessionId,
        pendingSkill: undefined,
        pendingAttachments: [],
      })
    }

    // Single Repl backed by the default agent
    this.repl = new Repl(this.agentOptions.get(ctx.defaultAgent)!)
  }

  async start(): Promise<void> {
    const app = this.ctx.agents.get(this.currentAgent)!
    const agentNames = [...this.ctx.agents.keys()]
    tui.printHeader(app.config.model, app.sessionId)
    console.log(`  Agents: ${agentNames.join(', ')} (active: ${this.currentAgent})`)
    console.log()

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdout.isTTY })
    rl.setPrompt(tui.PROMPT)

    this.repl.registerAskUser(rl)

    let lastInterruptTime = 0

    rl.on('SIGINT', () => {
      if (this.repl.hasPendingAsk()) {
        this.repl.cancelAsk()
        rl.setPrompt(tui.PROMPT)
        return
      }
      if (this.repl.isRunning) {
        this.repl.abort()
        return
      }
      const now = Date.now()
      if (now - lastInterruptTime < 1000) {
        tui.printInterrupt('Goodbye!')
        rl.close()
        return
      }
      lastInterruptTime = now
      tui.printInterrupt('Press Ctrl+C again to exit, or type a message.')
      rl.prompt()
    })

    let processing = false
    let inflight: Promise<void> | undefined
    rl.on('line', async (line: string) => {
      const trimmed = line.trim()

      if (this.repl.hasPendingAsk()) {
        if (!trimmed) { rl.prompt(); return }
        this.repl.resolveAsk(trimmed)
        rl.setPrompt(tui.PROMPT)
        return
      }

      if (!trimmed || processing) { if (!processing) rl.prompt(); return }
      processing = true

      inflight = (async () => {
        if (trimmed.startsWith('/')) {
          try {
            const response = this.handleMultiAgentCommand(trimmed)
              ?? await this.repl.handleCommand(trimmed)
            if (response) tui.printCommandResponse(response)
          } catch (err) {
            tui.printError(errorMessage(err))
          }
        } else {
          await this.repl.processInput(trimmed)
        }
        processing = false
        rl.prompt()
      })()
    })

    rl.on('close', () => tui.printInterrupt('Goodbye!'))
    rl.prompt()
    await new Promise<void>(resolve => rl.once('close', async () => { await inflight; resolve() }))
  }

  private handleMultiAgentCommand(input: string): string | undefined {
    const parts = input.split(/\s+/)
    const cmd = parts[0]

    switch (cmd) {
      case '/agent': {
        const name = parts[1]
        if (!name) return `Active agent: ${this.currentAgent}`
        if (!this.ctx.agents.has(name)) {
          return `Unknown agent: ${name}. Available: ${[...this.ctx.agents.keys()].join(', ')}`
        }
        // Save current agent's state, load target agent's state
        this.agentStates.set(this.currentAgent, this.repl.saveAgentState())
        this.currentAgent = name
        this.repl.loadAgentState(this.agentStates.get(name)!, this.agentOptions.get(name)!)
        const app = this.ctx.agents.get(name)!
        return `Switched to agent: ${name} (${app.config.provider}/${app.config.model})`
      }
      case '/agents': {
        const lines = [...this.ctx.agents.entries()].map(([name, app]) => {
          const active = name === this.currentAgent ? ' (active)' : ''
          return `  ${name}: ${app.config.provider}/${app.config.model}${active}`
        })
        return `Agents:\n${lines.join('\n')}`
      }
      default:
        return undefined
    }
  }
}

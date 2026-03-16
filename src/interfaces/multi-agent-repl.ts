/**
 * Multi-agent REPL — one Repl instance, swaps backing context on /agent switch.
 */
import { Repl, toReplOptions, type ReplOptions, type ReplAgentState } from './repl'
import type { MultiAgentContext } from '../multi-agent'

export class MultiAgentRepl {
  private ctx: MultiAgentContext
  private currentAgent: string
  private repl: Repl
  private agentStates = new Map<string, ReplAgentState>()
  private agentOptions = new Map<string, ReplOptions>()

  constructor(ctx: MultiAgentContext) {
    this.ctx = ctx
    this.currentAgent = ctx.defaultAgent

    for (const [name, app] of ctx.agents) {
      this.agentOptions.set(name, toReplOptions(app))
      this.agentStates.set(name, {
        messages: [],
        sessionId: app.sessionId,
        pendingSkill: undefined,
        pendingAttachments: [],
      })
    }

    const isMulti = ctx.agents.size > 1
    this.repl = new Repl({
      ...this.agentOptions.get(ctx.defaultAgent)!,
      ...(isMulti && {
        onCommand: (input: string) => this.handleMultiAgentCommand(input),
        headerExtra: `  Agents: ${[...ctx.agents.keys()].join(', ')} (active: ${this.currentAgent})`,
      }),
    })
  }

  async start(): Promise<void> {
    await this.repl.start()
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

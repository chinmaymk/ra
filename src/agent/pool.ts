/**
 * AgentPool — manages multiple named agent loops in a single process.
 *
 * All agents share the same provider, tools, middleware, and memory (from
 * bootstrap), but each maintains its own message history and optional
 * config overrides (model, system prompt, max iterations).
 *
 * This avoids spawning separate binaries (~40 MB each) per agent.
 */
import { AgentLoop, type AgentLoopOptions, type LoopResult } from './loop'
import type { IProvider, IMessage } from '../providers/types'
import type { MiddlewareConfig } from './types'
import type { ToolRegistry } from './tool-registry'
import type { CompactionConfig } from './context-compaction'

export interface AgentPoolConfig {
  provider: IProvider
  tools: ToolRegistry
  model: string
  middleware?: Partial<MiddlewareConfig>
  maxIterations?: number
  toolTimeout?: number
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
  systemPrompt?: string
  contextMessages?: IMessage[]
}

export interface AgentOverrides {
  model?: string
  systemPrompt?: string
  maxIterations?: number
  thinking?: 'low' | 'medium' | 'high'
}

export interface PoolAgent {
  name: string
  messages: IMessage[]
  overrides: AgentOverrides
  activeLoop: AgentLoop | null
  createdAt: number
}

export interface PoolAgentInfo {
  name: string
  messageCount: number
  running: boolean
  overrides: AgentOverrides
  createdAt: number
}

export class AgentPool {
  private agents = new Map<string, PoolAgent>()
  private config: AgentPoolConfig

  constructor(config: AgentPoolConfig) {
    this.config = config
  }

  /** Create a new named agent. Throws if name already exists. */
  create(name: string, overrides: AgentOverrides = {}): PoolAgentInfo {
    if (this.agents.has(name)) {
      throw new Error(`Agent '${name}' already exists`)
    }

    const agent: PoolAgent = {
      name,
      messages: [],
      overrides,
      activeLoop: null,
      createdAt: Date.now(),
    }

    // Prepend system prompt if configured
    const systemPrompt = overrides.systemPrompt ?? this.config.systemPrompt
    if (systemPrompt) {
      agent.messages.push({ role: 'system', content: systemPrompt })
    }
    if (this.config.contextMessages?.length) {
      agent.messages.push(...this.config.contextMessages)
    }

    this.agents.set(name, agent)
    return this.info(agent)
  }

  /** Send messages to a named agent and run the loop. Returns the new messages produced. */
  async chat(name: string, userMessages: IMessage[]): Promise<LoopResult> {
    const agent = this.agents.get(name)
    if (!agent) throw new Error(`Agent '${name}' not found`)
    if (agent.activeLoop) throw new Error(`Agent '${name}' is already running`)

    agent.messages.push(...userMessages)

    const loopOpts: AgentLoopOptions = {
      provider: this.config.provider,
      tools: this.config.tools,
      model: agent.overrides.model ?? this.config.model,
      middleware: this.config.middleware,
      maxIterations: agent.overrides.maxIterations ?? this.config.maxIterations,
      toolTimeout: this.config.toolTimeout,
      thinking: agent.overrides.thinking ?? this.config.thinking,
      compaction: this.config.compaction,
    }

    const loop = new AgentLoop(loopOpts)
    agent.activeLoop = loop

    try {
      const result = await loop.run(agent.messages)
      // Append new messages (loop returns all messages including input;
      // new messages start after the ones we passed in)
      const newMessages = result.messages.slice(agent.messages.length)
      agent.messages.push(...newMessages)
      return {
        ...result,
        messages: newMessages,
      }
    } finally {
      agent.activeLoop = null
    }
  }

  /** Abort a running agent's loop. */
  stop(name: string): void {
    const agent = this.agents.get(name)
    if (!agent) throw new Error(`Agent '${name}' not found`)
    if (agent.activeLoop) agent.activeLoop.abort()
  }

  /** Remove an agent (aborts if running). */
  remove(name: string): void {
    const agent = this.agents.get(name)
    if (!agent) throw new Error(`Agent '${name}' not found`)
    if (agent.activeLoop) agent.activeLoop.abort()
    this.agents.delete(name)
  }

  /** Get info about a specific agent. */
  get(name: string): PoolAgentInfo | undefined {
    const agent = this.agents.get(name)
    return agent ? this.info(agent) : undefined
  }

  /** List all agents. */
  list(): PoolAgentInfo[] {
    return [...this.agents.values()].map(a => this.info(a))
  }

  /** Number of agents in the pool. */
  get size(): number {
    return this.agents.size
  }

  private info(agent: PoolAgent): PoolAgentInfo {
    return {
      name: agent.name,
      messageCount: agent.messages.length,
      running: agent.activeLoop !== null,
      overrides: agent.overrides,
      createdAt: agent.createdAt,
    }
  }
}

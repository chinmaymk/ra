import readline from 'readline'
import { AgentLoop } from '../agent/loop'
import { fileToContentPart } from '../utils/files'
import type { ToolRegistry } from '../agent/tool-registry'
import type { MiddlewareConfig, StreamChunkContext, ToolExecutionContext, ToolResultContext } from '../agent/types'
import type { IMessage, IProvider, ContentPart } from '../providers/types'
import type { SessionStorage } from '../storage/sessions'
import type { Skill } from '../skills/types'
import { buildAvailableSkillsXml, buildActiveSkillXml } from '../skills/loader'
import type { CompactionConfig } from '../agent/context-compaction'
import { ASK_USER_SIGNAL } from '../tools/ask-user'
import * as tui from './tui'

export interface ReplOptions {
  model: string
  provider: IProvider
  tools: ToolRegistry
  storage: SessionStorage
  systemPrompt?: string
  skillMap?: Map<string, Skill>
  middleware?: Partial<MiddlewareConfig>
  maxIterations?: number
  toolTimeout?: number
  sessionId?: string
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
}

export class Repl {
  private options: ReplOptions
  private messages: IMessage[] = []
  private sessionId: string | undefined
  private pendingSkill: Skill | undefined
  private pendingAttachments: ContentPart[] = []

  constructor(options: ReplOptions) {
    this.options = options
    this.sessionId = options.sessionId
  }

  private async newSession(): Promise<string> {
    const s = await this.options.storage.create({ provider: this.options.provider.name, model: this.options.model, interface: 'repl' })
    return s.id
  }

  async start(): Promise<void> {
    if (this.sessionId) {
      this.messages = await this.options.storage.readMessages(this.sessionId)
    } else {
      this.sessionId = await this.newSession()
    }

    tui.printHeader(this.options.model, this.sessionId!)
    if (this.options.sessionId) {
      tui.printResumeHeader(this.sessionId!, this.messages.length)
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdout.isTTY })
    rl.setPrompt(tui.PROMPT)
    const prompt = () => rl.prompt()
    prompt()

    for await (const line of rl) {
      const trimmed = (line as string).trim()
      if (!trimmed) { prompt(); continue }

      if (trimmed.startsWith('/')) {
        try {
          const response = await this.handleCommand(trimmed)
          if (response) tui.printCommandResponse(response)
        } catch (err) {
          tui.printError(err instanceof Error ? err.message : String(err))
        }
      } else {
        await this.processInput(trimmed)
      }
      prompt()
    }
  }

  async processInput(input: string): Promise<void> {
    if (!this.sessionId) this.sessionId = await this.newSession()

    const text = this.pendingSkill
      ? `${buildActiveSkillXml(this.pendingSkill)}\n\n${input}`
      : input
    this.pendingSkill = undefined

    const parts: ContentPart[] = [{ type: 'text', text }, ...this.pendingAttachments]
    this.pendingAttachments = []

    const userMessage: IMessage = { role: 'user', content: parts.length === 1 ? text : parts }
    const initialMessages: IMessage[] = [
      ...(this.options.systemPrompt ? [{ role: 'system' as const, content: this.options.systemPrompt }] : []),
      ...this.messages,
      userMessage,
    ]

    // Inject available skills XML as first user message if skills exist
    if (this.options.skillMap && this.options.skillMap.size > 0 && this.messages.length === 0) {
      const xml = buildAvailableSkillsXml(this.options.skillMap)
      if (xml) {
        initialMessages.splice(
          this.options.systemPrompt ? 1 : 0,
          0,
          { role: 'user', content: xml }
        )
      }
    }

    let boxOpened = false
    let thinkingOpened = false
    const toolStartTimes = new Map<string, number>()
    process.stdout.write('\n')
    tui.startSpinner()
    const userMw = this.options.middleware ?? {}

    const loop = new AgentLoop({
      provider: this.options.provider,
      tools: this.options.tools,
      model: this.options.model,
      maxIterations: this.options.maxIterations,
      toolTimeout: this.options.toolTimeout,
      sessionId: this.sessionId,
      thinking: this.options.thinking,
      compaction: this.options.compaction,
      middleware: {
        ...userMw,
        onStreamChunk: [
          async (ctx: StreamChunkContext) => {
            if (ctx.chunk.type === 'thinking') {
              if (!thinkingOpened) {
                tui.stopSpinner(true)
                tui.printThinkingStart()
                thinkingOpened = true
              }
              process.stdout.write(ctx.chunk.delta)
            } else if (ctx.chunk.type === 'text') {
              if (thinkingOpened) {
                tui.printThinkingEnd()
                thinkingOpened = false
              }
              if (!boxOpened) { tui.stopSpinner(); boxOpened = true }
              process.stdout.write(ctx.chunk.delta)
            }
          },
          ...(userMw.onStreamChunk ?? []),
        ],
        beforeToolExecution: [
          async (ctx: ToolExecutionContext) => { tui.stopSpinner(true); toolStartTimes.set(ctx.toolCall.id, Date.now()); tui.printToolCall(ctx.toolCall.name) },
          ...(userMw.beforeToolExecution ?? []),
        ],
        afterToolExecution: [
          async (ctx: ToolResultContext) => { tui.printToolResult(ctx.toolCall.name, Date.now() - (toolStartTimes.get(ctx.toolCall.id) ?? Date.now())); if (!boxOpened) tui.startSpinner() },
          ...(userMw.afterToolExecution ?? []),
        ],
      },
    })

    try {
      const result = await loop.run(initialMessages)
      if (thinkingOpened) { tui.printThinkingEnd(); thinkingOpened = false }
      tui.stopSpinner(true) // no-op if already stopped by first text chunk; clears spinner if tool-only
      if (boxOpened) tui.closeAssistantBox()
      else process.stdout.write('\n')

      const newMessages = result.messages.slice(initialMessages.length)
      this.messages.push(userMessage, ...newMessages)
      for (const msg of [userMessage, ...newMessages]) {
        await this.options.storage.appendMessage(this.sessionId!, msg)
      }

      // Detect ask_user — in REPL, just print the question; next input resumes naturally
      let askMsg: IMessage | undefined
      for (let i = result.messages.length - 1; i >= 0; i--) {
        const m = result.messages[i]!
        if (m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(ASK_USER_SIGNAL)) {
          askMsg = m
          break
        }
      }
      if (askMsg && typeof askMsg.content === 'string') {
        const question = askMsg.content.slice(ASK_USER_SIGNAL.length)
        tui.printCommandResponse(`[Question for you] ${question}`)
      }
    } catch (err) {
      tui.stopSpinner(true)
      if (boxOpened) tui.closeAssistantBox()
      else process.stdout.write('\n')
      tui.printError(err instanceof Error ? err.message : String(err))
    }
  }

  async handleCommand(input: string): Promise<string> {
    const parts = input.split(/\s+/)
    const cmd = parts[0]

    switch (cmd) {
      case '/clear': {
        this.messages = []
        this.sessionId = await this.newSession()
        return 'Message history cleared.'
      }
      case '/save':
        return `Session ${this.sessionId} saved (auto-saved after each turn).`
      case '/resume': {
        const id = parts[1]
        if (!id) return 'Usage: /resume <session-id>'
        const messages = await this.options.storage.readMessages(id)
        if (messages.length === 0) {
          // Verify session exists by checking if it's in the session list
          const sessions = await this.options.storage.list()
          if (!sessions.some(s => s.id === id)) {
            return `Session not found: ${id}`
          }
        }
        this.messages = messages
        this.sessionId = id
        this.pendingSkill = undefined
        this.pendingAttachments = []
        return `Resumed session ${id} (${this.messages.length} messages loaded).`
      }
      case '/skill': {
        const name = parts[1]
        if (!name) return 'Usage: /skill <name>'
        const skill = this.options.skillMap?.get(name)
        if (!skill) return `Skill not found: ${name}`
        this.pendingSkill = skill
        return `Skill "${name}" will be injected with your next message.`
      }
      case '/attach': {
        const filePath = parts.slice(1).join(' ')
        if (!filePath) return 'Usage: /attach <path>'
        try {
          this.pendingAttachments.push(await fileToContentPart(filePath))
          return `Attached: ${filePath}`
        } catch (err) {
          return `Failed to attach file: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      default:
        return `Unknown command: ${cmd}`
    }
  }
}

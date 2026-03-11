import readline from 'readline'
import { AgentLoop } from '../agent/loop'
import { fileToContentPart } from '../utils/files'
import type { ToolRegistry } from '../agent/tool-registry'
import type { MiddlewareConfig, StreamChunkContext, ToolExecutionContext, ToolResultContext } from '../agent/types'
import type { IMessage, IProvider, ContentPart } from '../providers/types'
import type { SessionStorage } from '../storage/sessions'
import type { Skill } from '../skills/types'
import { buildAvailableSkillsXml, buildActiveSkillXml, readSkillReference } from '../skills/loader'
import type { CompactionConfig } from '../agent/context-compaction'
import type { MemoryStore } from '../memory/store'
import { ASK_USER_SIGNAL } from '../tools/ask-user'
import { runSkillScriptByName } from '../skills/runner'
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
  contextMessages?: IMessage[]
  memoryStore?: MemoryStore
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
      ...(this.messages.length === 0 && this.options.contextMessages?.length ? this.options.contextMessages : []),
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
      tui.stopSpinner(true)
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
      case '/skill-run': {
        const skillName = parts[1]
        const scriptName = parts[2]
        if (!skillName || !scriptName) return 'Usage: /skill-run <skill> <script>'
        const skill = this.options.skillMap?.get(skillName)
        if (!skill) return `Skill not found: ${skillName}`
        const output = await runSkillScriptByName(skill, scriptName, {})
        if (output.trim()) {
          this.pendingAttachments.push({ type: 'text', text: `<skill-script name="${scriptName}">\n${output.trim()}\n</skill-script>` })
          return `Script output from "${scriptName}" will be attached to your next message.`
        }
        return `Script "${scriptName}" produced no output.`
      }
      case '/skill-ref': {
        const skillName = parts[1]
        const refName = parts[2]
        if (!skillName || !refName) return 'Usage: /skill-ref <skill> <reference>'
        const skill = this.options.skillMap?.get(skillName)
        if (!skill) return `Skill not found: ${skillName}`
        const content = await readSkillReference(skill, refName)
        if (content.trim()) {
          this.pendingAttachments.push({ type: 'text', text: `<skill-reference name="${refName}">\n${content.trim()}\n</skill-reference>` })
          return `Reference "${refName}" will be attached to your next message.`
        }
        return `Reference "${refName}" is empty.`
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
      case '/memories': {
        if (!this.options.memoryStore) return 'Memory is not enabled. Use --memory or set memory.enabled in config.'
        const limit = parts[1] ? parseInt(parts[1], 10) : 20
        const memories = this.options.memoryStore.list(Number.isNaN(limit) ? 20 : limit)
        if (memories.length === 0) return 'No memories stored.'
        const lines = memories.map(m =>
          `  [${m.id}] [${m.tags || 'general'}] ${m.content}`
        )
        return `${memories.length} memories (${this.options.memoryStore.count()} total):\n${lines.join('\n')}`
      }
      case '/forget': {
        if (!this.options.memoryStore) return 'Memory is not enabled. Use --memory or set memory.enabled in config.'
        const query = parts.slice(1).join(' ')
        if (!query) return 'Usage: /forget <search query>'
        const deleted = this.options.memoryStore.forget(query, 1000)
        return deleted > 0 ? `Forgot ${deleted} memory(s).` : 'No matching memories found.'
      }
      case '/context': {
        if (!this.options.contextMessages?.length) return 'No context files discovered.'
        const lines = this.options.contextMessages.map(m => {
          const content = typeof m.content === 'string' ? m.content : ''
          const pathMatch = content.match(/<context-file path="([^"]+)">/)
          const path = pathMatch?.[1] ?? 'unknown'
          const size = content.length
          return `  ${path}  (${size} chars)`
        })
        return `Discovered context files:\n${lines.join('\n')}`
      }
      default:
        return `Unknown command: ${cmd}`
    }
  }
}

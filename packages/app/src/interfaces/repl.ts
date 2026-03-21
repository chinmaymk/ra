import readline from 'readline'
import {
  AgentLoop,
  mergeMiddleware,
  errorMessage,
  estimateTokens,
  type ToolRegistry,
  type MiddlewareConfig,
  type StreamChunkContext,
  type ToolExecutionContext,
  type ToolResultContext,
  type IMessage,
  type IProvider,
  type ContentPart,
  type CompactionConfig,
  type Logger,
  type LogLevel,
} from '@chinmaymk/ra'
import { fileToContentPart } from '../utils/files'
import type { SessionStorage } from '../storage/sessions'
import { createSessionMiddleware } from '../agent/session'
import type { Skill, SkillIndex } from '../skills/types'
import { loadSkill, buildActiveSkillXml, readSkillReference } from '../skills/loader'
import { buildMessagePrefix } from './messages'
import type { MemoryStore } from '../memory/store'
import { askUserTool } from '../tools/ask-user'
import { runSkillScriptByName } from '../skills/runner'
import { extractContextFilePath } from '../context'
import * as tui from './tui'

export interface ReplOptions {
  model: string
  provider: IProvider
  tools: ToolRegistry
  storage: SessionStorage
  systemPrompt?: string
  skillIndex?: Map<string, SkillIndex>
  middleware?: Partial<MiddlewareConfig>
  maxIterations?: number
  maxRetries?: number
  toolTimeout?: number
  maxToolResponseSize?: number
  sessionId?: string
  resumed?: boolean
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
  contextMessages?: IMessage[]
  memoryStore?: MemoryStore
  logger?: Logger
  logsEnabled?: boolean
  logLevel?: LogLevel
  tracesEnabled?: boolean
}

const DOUBLE_PRESS_TIMEOUT_MS = 1000

export class Repl {
  private options: ReplOptions
  private messages: IMessage[] = []
  private sessionId: string | undefined
  private pendingSkill: Skill | undefined
  private pendingAttachments: ContentPart[] = []
  private askUserResolve: ((answer: string) => void) | undefined
  private activeLoop: AgentLoop | null = null
  private lastInterruptTime = 0
  private skillCache = new Map<string, Promise<Skill>>()

  constructor(options: ReplOptions) {
    this.options = options
    this.sessionId = options.sessionId
  }

  /** Lazy-load a full skill by name, caching the result. */
  private async getSkill(name: string): Promise<Skill | undefined> {
    const index = this.options.skillIndex?.get(name)
    if (!index) return undefined
    if (!this.skillCache.has(name)) this.skillCache.set(name, loadSkill(index))
    return this.skillCache.get(name)!
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

    tui.printHeader(this.options.model, this.sessionId as string)
    if (this.options.resumed) {
      tui.printResumeHeader(this.sessionId as string, this.messages.length)
    }

    // Register AskUserQuestion to read inline from the terminal
    const { description, inputSchema } = askUserTool()
    this.options.tools.register({
      name: 'AskUserQuestion',
      description,
      inputSchema,
      execute: async (input: unknown) => {
        const { question } = input as { question: string }
        tui.stopSpinner(true)
        tui.printCommandResponse(question)
        rl.setPrompt('  > ')
        rl.prompt()
        return new Promise<string>(resolve => { this.askUserResolve = resolve })
      },
    })

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdout.isTTY })
    rl.setPrompt(tui.PROMPT)

    // Ctrl+C: cancel active request or double-press to exit
    rl.on('SIGINT', () => {
      if (this.askUserResolve) {
        const resolve = this.askUserResolve
        this.askUserResolve = undefined
        rl.setPrompt(tui.PROMPT)
        resolve('')
        return
      }
      if (this.activeLoop) {
        this.activeLoop.abort()
        return
      }
      const now = Date.now()
      if (now - this.lastInterruptTime < DOUBLE_PRESS_TIMEOUT_MS) {
        tui.printInterrupt('Goodbye!')
        rl.close()
        return
      }
      this.lastInterruptTime = now
      tui.printInterrupt('Press Ctrl+C again to exit, or type a message.')
      rl.prompt()
    })

    let processing = false
    let inflight: Promise<void> | undefined
    rl.on('line', async (line: string) => {
      const trimmed = line.trim()

      // Route answer to waiting ask_user Promise
      if (this.askUserResolve) {
        if (!trimmed) { rl.prompt(); return }
        const resolve = this.askUserResolve
        this.askUserResolve = undefined
        rl.setPrompt(tui.PROMPT)
        resolve(trimmed)
        return
      }

      if (!trimmed || processing) { if (!processing) rl.prompt(); return }
      processing = true

      inflight = (async () => {
        if (trimmed.startsWith('/')) {
          try {
            const response = await this.handleCommand(trimmed)
            if (response) tui.printCommandResponse(response)
          } catch (err) {
            tui.printError(errorMessage(err))
          }
        } else {
          await this.processInput(trimmed)
        }
        processing = false
        rl.prompt()
      })()
    })

    rl.on('close', () => tui.printInterrupt('Goodbye!'))
    rl.prompt()
    await new Promise<void>(resolve => rl.once('close', async () => { await inflight; resolve() }))
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

    // On a brand-new session, build the prefix (system prompt, skills, context)
    // and store it as the first messages in the thread.  On subsequent turns or
    // after a resume the prefix is already in this.messages — never re-inject it.
    const isNewSession = this.messages.length === 0
    if (isNewSession) {
      const prefix = buildMessagePrefix({
        systemPrompt: this.options.systemPrompt,
        skillIndex: this.options.skillIndex,
        contextMessages: this.options.contextMessages,
      })
      this.messages.push(...prefix)
    }

    // priorCount = messages already persisted on disk.
    // New session: nothing on disk yet (0) — prefix + user message will be saved.
    // Existing session: all of this.messages are on disk — only new messages saved.
    const priorCount = isNewSession ? 0 : this.messages.length
    const snapshotLength = this.messages.length
    const initialMessages = [...this.messages, userMessage]

    const tuiState = tui.createStreamState()
    tui.startSpinner()
    const session = createSessionMiddleware(this.options.middleware, {
      storage: this.options.storage,
      sessionId: this.sessionId as string,
      priorCount,
      logsEnabled: this.options.logsEnabled,
      logLevel: this.options.logLevel,
      tracesEnabled: this.options.tracesEnabled,
      logger: this.options.logger,
    })

    const tuiHooks: Partial<MiddlewareConfig> = {
      onStreamChunk: [
        async (ctx: StreamChunkContext) => {
          tui.handleStreamChunk(tuiState, ctx.chunk.type, 'delta' in ctx.chunk ? ctx.chunk.delta : undefined)
        },
      ],
      beforeToolExecution: [
        async (ctx: ToolExecutionContext) => {
          const out = tuiState.streamBuf?.end(); if (out) process.stdout.write(out)
          tui.stopSpinner(true)
          tuiState.boxOpened = false
          tuiState.toolStartTimes.set(ctx.toolCall.id, Date.now())
          tui.printToolCall(ctx.toolCall.name, ctx.toolCall.arguments)
        },
      ],
      afterToolExecution: [
        async (ctx: ToolResultContext) => {
          tui.printToolResult(ctx.toolCall.name, Date.now() - (tuiState.toolStartTimes.get(ctx.toolCall.id) ?? Date.now()))
          tui.startSpinner()
        },
      ],
    }

    const loop = new AgentLoop({
      provider: this.options.provider,
      tools: this.options.tools,
      model: this.options.model,
      maxIterations: this.options.maxIterations,
      maxRetries: this.options.maxRetries,
      toolTimeout: this.options.toolTimeout,
      maxToolResponseSize: this.options.maxToolResponseSize,
      sessionId: this.sessionId,
      thinking: this.options.thinking,
      compaction: this.options.compaction,
      logger: session.logger,
      middleware: mergeMiddleware(tuiHooks, session.middleware),
    })

    this.activeLoop = loop
    try {
      const result = await loop.run(initialMessages)
      tui.flushStreamState(tuiState)
      this.messages.push(...result.messages.slice(snapshotLength))
    } catch (err) {
      tui.flushStreamState(tuiState)
      if (err instanceof DOMException && err.name === 'AbortError') {
        tui.printInterrupt('Request cancelled.')
      } else {
        tui.printError(errorMessage(err))
      }
    } finally {
      this.activeLoop = null
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
        let id = parts[1]
        if (!id) {
          const latest = await this.options.storage.latest()
          if (!latest) return 'No sessions to resume.'
          id = latest.id
        }
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
        if (!name) return 'Usage: /skill <name>  (or just /<skill-name>)'
        const skill = await this.getSkill(name)
        if (!skill) return `Skill not found: ${name}`
        this.pendingSkill = skill
        return `Skill "${name}" will be injected with your next message.`
      }
      case '/skill-run':
      case '/skill-ref': {
        const isRun = cmd === '/skill-run'
        const skillName = parts[1]
        const targetName = parts[2]
        if (!skillName || !targetName) return `Usage: ${cmd} <skill> <${isRun ? 'script' : 'reference'}>`
        const skill = await this.getSkill(skillName)
        if (!skill) return `Skill not found: ${skillName}`
        const output = isRun
          ? await runSkillScriptByName(skill, targetName, {})
          : await readSkillReference(skill, targetName)
        if (output.trim()) {
          const tag = isRun ? 'skill-script' : 'skill-reference'
          this.pendingAttachments.push({ type: 'text', text: `<${tag} name="${targetName}">\n${output.trim()}\n</${tag}>` })
          return `${isRun ? 'Script output from' : 'Reference'} "${targetName}" will be attached to your next message.`
        }
        return `${isRun ? 'Script' : 'Reference'} "${targetName}" ${isRun ? 'produced no output' : 'is empty'}.`
      }
      case '/attach': {
        const filePath = parts.slice(1).join(' ')
        if (!filePath) return 'Usage: /attach <path>'
        try {
          this.pendingAttachments.push(await fileToContentPart(filePath))
          return `Attached: ${filePath}`
        } catch (err) {
          return `Failed to attach file: ${errorMessage(err)}`
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
        let totalTokens = 0
        const lines = this.options.contextMessages.map(m => {
          const path = extractContextFilePath(m) ?? 'unknown'
          const content = typeof m.content === 'string' ? m.content : ''
          const tokens = estimateTokens(content)
          totalTokens += tokens
          return `  ${path}  (${content.length} chars, ~${tokens} tokens)`
        })
        lines.push(`  ── total: ~${totalTokens} tokens`)
        return `Discovered context files:\n${lines.join('\n')}`
      }
      default: {
        // Check if the command matches a skill name (e.g. /verify → skill "verify")
        const skillName = (cmd ?? '').slice(1) // strip leading /
        const skill = await this.getSkill(skillName)
        if (skill) {
          this.pendingSkill = skill
          return `Skill "${skillName}" will be injected with your next message.`
        }
        return `Unknown command: ${cmd}`
      }
    }
  }
}

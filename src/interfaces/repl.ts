import readline from 'readline'
import { AgentLoop } from '../agent/loop'
import { fileToContentPart } from '../utils/files'
import { errorMessage } from '../utils/errors'
import type { IMessage, ContentPart } from '../providers/types'
import type { Skill } from '../skills/types'
import type { MemoryStore } from '../memory/store'
import { buildAvailableSkillsXml, buildActiveSkillXml, readSkillReference } from '../skills/loader'
import { askUserTool } from '../tools/ask-user'
import { runSkillScriptByName } from '../skills/runner'
import { toBaseOptions, type AppContext, type BaseOptions } from '../bootstrap'
import * as tui from './tui'

export interface ReplOptions extends BaseOptions {
  sessionId?: string
  memoryStore?: MemoryStore
  /** Optional command interceptor — return a string to handle the command, undefined to fall through. */
  onCommand?: (input: string) => string | undefined
  /** Extra text to display after the header on start. */
  headerExtra?: string
}

/** Build ReplOptions from an AppContext. */
export function toReplOptions(app: AppContext): ReplOptions {
  return { ...toBaseOptions(app), sessionId: app.sessionId, memoryStore: app.memoryStore }
}

export interface ReplAgentState {
  messages: IMessage[]
  sessionId: string | undefined
  pendingSkill: Skill | undefined
  pendingAttachments: ContentPart[]
}

export class Repl {
  private options: ReplOptions
  private messages: IMessage[] = []
  private sessionId: string | undefined
  private pendingSkill: Skill | undefined
  private pendingAttachments: ContentPart[] = []
  private askUserResolve: ((answer: string) => void) | undefined
  private activeLoop: AgentLoop | null = null
  private lastInterruptTime = 0
  private rl: readline.Interface | undefined

  constructor(options: ReplOptions) {
    this.options = options
    this.sessionId = options.sessionId
  }

  private async newSession(): Promise<string> {
    const s = await this.options.storage!.create({ provider: this.options.provider.name, model: this.options.model, interface: 'repl' })
    return s.id
  }

  /** Register AskUserQuestion tool wired to an external readline interface. */
  registerAskUser(rl: readline.Interface): void {
    this.rl = rl
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
  }

  /** Snapshot per-agent conversation state (for multi-agent context switching). */
  saveAgentState(): ReplAgentState {
    return {
      messages: this.messages,
      sessionId: this.sessionId,
      pendingSkill: this.pendingSkill,
      pendingAttachments: this.pendingAttachments,
    }
  }

  /** Restore per-agent conversation state and swap backing options. Re-registers AskUser on new tools. */
  loadAgentState(state: ReplAgentState, options: ReplOptions): void {
    this.messages = state.messages
    this.sessionId = state.sessionId
    this.pendingSkill = state.pendingSkill
    this.pendingAttachments = state.pendingAttachments
    this.options = options
    if (this.rl) this.registerAskUser(this.rl)
  }

  /** Whether an AskUserQuestion is waiting for input. */
  hasPendingAsk(): boolean { return !!this.askUserResolve }

  /** Resolve a pending AskUserQuestion with the given answer. */
  resolveAsk(answer: string): void {
    const resolve = this.askUserResolve
    this.askUserResolve = undefined
    resolve?.(answer)
  }

  /** Cancel a pending AskUserQuestion (empty answer). */
  cancelAsk(): void { this.resolveAsk('') }

  /** Abort the currently running agent loop. */
  abort(): void { this.activeLoop?.abort() }

  /** Whether a loop is currently running. */
  get isRunning(): boolean { return !!this.activeLoop }

  async start(): Promise<void> {
    if (this.sessionId) {
      this.messages = await this.options.storage!.readMessages(this.sessionId)
    } else {
      this.sessionId = await this.newSession()
    }

    tui.printHeader(this.options.model, this.sessionId!)
    if (this.options.headerExtra) console.log(this.options.headerExtra)
    if (this.options.sessionId) {
      tui.printResumeHeader(this.sessionId!, this.messages.length)
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdout.isTTY })
    rl.setPrompt(tui.PROMPT)

    this.registerAskUser(rl)

    // Ctrl+C: cancel active request or double-press to exit
    rl.on('SIGINT', () => {
      if (this.hasPendingAsk()) {
        this.cancelAsk()
        rl.setPrompt(tui.PROMPT)
        return
      }
      if (this.activeLoop) {
        this.activeLoop.abort()
        return
      }
      const now = Date.now()
      if (now - this.lastInterruptTime < 1000) {
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
      if (this.hasPendingAsk()) {
        if (!trimmed) { rl.prompt(); return }
        this.resolveAsk(trimmed)
        rl.setPrompt(tui.PROMPT)
        return
      }

      if (!trimmed || processing) { if (!processing) rl.prompt(); return }
      processing = true

      inflight = (async () => {
        if (trimmed.startsWith('/')) {
          try {
            const response = this.options.onCommand?.(trimmed) ?? await this.handleCommand(trimmed)
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

    const initialMessages: IMessage[] = []
    if (this.options.systemPrompt) initialMessages.push({ role: 'system', content: this.options.systemPrompt })
    if (this.options.contextMessages?.length) initialMessages.push(...this.options.contextMessages)
    initialMessages.push(...this.messages, userMessage)

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

    const { middleware: tuiMw, cleanup } = tui.createTuiMiddleware(this.options.middleware ?? {})
    tui.startSpinner()

    const loop = new AgentLoop({
      provider: this.options.provider,
      tools: this.options.tools,
      model: this.options.model,
      maxIterations: this.options.maxIterations,
      toolTimeout: this.options.toolTimeout,
      sessionId: this.sessionId,
      thinking: this.options.thinking,
      compaction: this.options.compaction,
      middleware: { ...(this.options.middleware ?? {}), ...tuiMw },
    })

    this.activeLoop = loop
    const priorCount = initialMessages.length
    try {
      const result = await loop.run(initialMessages)
      cleanup()

      const newMessages = result.messages.slice(priorCount)
      this.messages.push(userMessage, ...newMessages)
      await Promise.all([userMessage, ...newMessages].map(msg => this.options.storage!.appendMessage(this.sessionId!, msg)))
    } catch (err) {
      cleanup()
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
        const id = parts[1]
        if (!id) return 'Usage: /resume <session-id>'
        const messages = await this.options.storage!.readMessages(id)
        if (messages.length === 0) {
          const sessions = await this.options.storage!.list()
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

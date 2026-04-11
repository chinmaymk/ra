import { join } from 'path'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import type { IMessage, Logger, TokenUsage } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'
import { parseJsonlFile } from '../utils/files'

const MS_PER_DAY = 86_400_000
const UNSAFE_SESSION_ID_CHARS = /[^a-zA-Z0-9_-]/g

export interface SessionMeta {
  id: string
  created: string
  provider: string
  model: string
  interface: string
  namespace?: string
  configDir?: string
  title?: string
  tokenUsage?: TokenUsage
  iteration?: number
  lastAssistantMessage?: string
  /** Git worktree for this session, if any (web UI). */
  worktree?: { path: string; branch: string }
  /** Working directory for tools / diff (worktree path or cwd at session creation). */
  sessionCwd?: string
  /**
   * Last persisted lifecycle status (web UI). Restored on `ra web` restart so
   * the session list reflects the state the user left it in. Running sessions
   * are rehydrated as 'needs-input' since their loop does not survive restart.
   */
  status?: 'idle' | 'running' | 'needs-input' | 'error' | 'done'
  /**
   * CC session UUID captured from the anthropic-agents-sdk provider's init
   * event. Persisted so a new provider instance after an ra process restart
   * can `resume` the same CC conversation instead of starting fresh.
   */
  sdkSessionId?: string
}

export interface Session {
  id: string
  meta: SessionMeta
}

export interface CreateSessionOptions {
  provider: string
  model: string
  interface: string
  namespace?: string
  configDir?: string
}

export interface PruneOptions {
  maxSessions?: number
  ttlDays?: number
}

export class SessionStorage {
  private storagePath: string
  private logger: Logger

  constructor(storagePath: string, logger?: Logger) {
    this.storagePath = storagePath
    this.logger = logger ?? new NoopLogger()
  }

  setLogger(logger: Logger): void {
    this.logger = logger
  }

  async init(): Promise<void> {
    await mkdir(this.storagePath, { recursive: true })
  }

  sessionDir(id: string): string {
    const sanitized = id.replace(UNSAFE_SESSION_ID_CHARS, '')
    if (!sanitized) throw new Error('Invalid session ID')
    return join(this.storagePath, sanitized)
  }

  private async writeMeta(id: string, options: CreateSessionOptions): Promise<SessionMeta> {
    const meta: SessionMeta = { id, created: new Date().toISOString(), ...options }
    const dir = this.sessionDir(id)
    await mkdir(dir, { recursive: true })
    await Bun.write(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    return meta
  }

  async create(options: CreateSessionOptions): Promise<Session> {
    const id = crypto.randomUUID()
    const meta = await this.writeMeta(id, options)
    this.logger.debug('session created', { sessionId: id, provider: options.provider, model: options.model })
    return { id, meta }
  }

  /** Merge a partial patch into an existing session's meta.json. */
  async updateMeta(id: string, patch: Partial<Omit<SessionMeta, 'id' | 'created'>>): Promise<void> {
    const path = join(this.sessionDir(id), 'meta.json')
    const file = Bun.file(path)
    if (!(await file.exists())) return
    const current = JSON.parse(await file.text()) as SessionMeta
    const next: SessionMeta = { ...current, ...patch }
    await Bun.write(path, JSON.stringify(next, null, 2))
  }

  async appendMessage(id: string, message: IMessage): Promise<void> {
    await appendFile(join(this.sessionDir(id), 'messages.jsonl'), JSON.stringify(message) + '\n')
  }

  /** Append multiple messages in a single filesystem write. */
  async appendMessages(id: string, messages: IMessage[]): Promise<void> {
    if (messages.length === 0) return
    const data = messages.map(m => JSON.stringify(m)).join('\n') + '\n'
    await appendFile(join(this.sessionDir(id), 'messages.jsonl'), data)
  }

  async readMessages(id: string): Promise<IMessage[]> {
    const messages = await parseJsonlFile<IMessage>(join(this.sessionDir(id), 'messages.jsonl'))
    this.logger.debug('messages loaded', { sessionId: id, messageCount: messages.length })
    return messages
  }

  async list(): Promise<Session[]> {
    const glob = new Bun.Glob('*/meta.json')
    const sessions: Session[] = []
    for await (const rel of glob.scan({ cwd: this.storagePath, onlyFiles: true })) {
      const meta = JSON.parse(await Bun.file(join(this.storagePath, rel)).text()) as SessionMeta
      sessions.push({ id: meta.id, meta })
    }
    return sessions
  }

  /** Return the most recently created session, or undefined if none exist. */
  async latest(): Promise<Session | undefined> {
    const sessions = await this.list()
    if (sessions.length === 0) return undefined
    return sessions.sort((a, b) => new Date(b.meta.created).getTime() - new Date(a.meta.created).getTime())[0]
  }

  /** Ensure a session directory exists for a given ID (creates it if needed). */
  async ensureSession(id: string, options: CreateSessionOptions): Promise<{ id: string; isNew: boolean }> {
    const metaPath = join(this.sessionDir(id), 'meta.json')
    const isNew = !(await Bun.file(metaPath).exists())
    if (isNew) {
      await this.writeMeta(id, options)
      this.logger.info('session created', { sessionId: id, provider: options.provider, model: options.model })
    }
    return { id, isNew }
  }

  async prune(options: PruneOptions): Promise<void> {
    const sessions = (await this.list()).sort((a, b) => new Date(a.meta.created).getTime() - new Date(b.meta.created).getTime())
    const toDelete = new Set<string>()

    if (options.ttlDays !== undefined) {
      const cutoff = Date.now() - options.ttlDays * MS_PER_DAY
      for (const s of sessions) if (new Date(s.meta.created).getTime() < cutoff) toDelete.add(s.id)
    }
    if (options.maxSessions !== undefined) {
      const remaining = sessions.filter(s => !toDelete.has(s.id))
      if (remaining.length > options.maxSessions) {
        for (const s of remaining.slice(0, remaining.length - options.maxSessions)) toDelete.add(s.id)
      }
    }

    if (toDelete.size > 0) {
      this.logger.info('sessions pruned', { pruned: toDelete.size, ttlDays: options.ttlDays, maxSessions: options.maxSessions })
    }

    await Promise.all([...toDelete].map(id => rm(this.sessionDir(id), { recursive: true, force: true })))
  }

  /** Delete a single session by ID. */
  async delete(id: string): Promise<void> {
    await rm(this.sessionDir(id), { recursive: true, force: true })
    this.logger.info('session deleted', { sessionId: id })
  }

  /** Delete all sessions in this storage directory. */
  async deleteAll(): Promise<void> {
    const sessions = await this.list()
    await Promise.all(sessions.map(s => rm(this.sessionDir(s.id), { recursive: true, force: true })))
    this.logger.info('all sessions deleted', { count: sessions.length })
  }

  /** List sessions across all namespaces under a global directory (e.g. ~/.ra/). */
  static async listAll(globalDir: string): Promise<Session[]> {
    const glob = new Bun.Glob('*/sessions/*/meta.json')
    const sessions: Session[] = []
    for await (const rel of glob.scan({ cwd: globalDir, onlyFiles: true })) {
      try {
        const meta = JSON.parse(await Bun.file(join(globalDir, rel)).text()) as SessionMeta
        sessions.push({ id: meta.id, meta })
      } catch { /* skip corrupt session entries */ }
    }
    return sessions
  }

  /** List all handle (namespace) directories under the global directory. */
  static async listHandles(globalDir: string): Promise<string[]> {
    const glob = new Bun.Glob('*/sessions')
    const handles: string[] = []
    for await (const rel of glob.scan({ cwd: globalDir, onlyFiles: false })) {
      handles.push(rel.replace(/\/sessions$/, ''))
    }
    return handles.sort()
  }

  /** Delete a session from a specific namespace under the global directory. */
  static async deleteFromNamespace(globalDir: string, namespace: string, id: string): Promise<void> {
    const sanitized = id.replace(UNSAFE_SESSION_ID_CHARS, '')
    if (!sanitized) throw new Error('Invalid session ID')
    await rm(join(globalDir, namespace, 'sessions', sanitized), { recursive: true, force: true })
  }

  /** Delete an entire handle directory (all sessions + data for a project). */
  static async deleteHandle(globalDir: string, namespace: string): Promise<void> {
    await rm(join(globalDir, namespace), { recursive: true, force: true })
  }

  /** Delete all sessions across all namespaces under the global directory. */
  static async deleteAllGlobal(globalDir: string): Promise<void> {
    const sessions = await SessionStorage.listAll(globalDir)
    await Promise.all(sessions.map(s => {
      if (!s.meta.namespace) return Promise.resolve()
      return SessionStorage.deleteFromNamespace(globalDir, s.meta.namespace, s.id)
    }))
  }
}

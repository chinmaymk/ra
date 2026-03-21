import { join } from 'path'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import type { IMessage } from '@chinmaymk/ra'
import { parseJsonlFile } from '../utils/files'

const MS_PER_DAY = 86_400_000
const UNSAFE_SESSION_ID_CHARS = /[^a-zA-Z0-9_-]/g

export interface SessionMeta {
  id: string
  created: string
  provider: string
  model: string
  interface: string
}

export interface Session {
  id: string
  meta: SessionMeta
}

export interface CreateSessionOptions {
  provider: string
  model: string
  interface: string
}

export interface PruneOptions {
  maxSessions?: number
  ttlDays?: number
}

export class SessionStorage {
  private storagePath: string

  constructor(storagePath: string) {
    this.storagePath = storagePath
  }

  async init(): Promise<void> {
    await mkdir(this.storagePath, { recursive: true })
  }

  sessionDir(id: string): string {
    const sanitized = id.replace(UNSAFE_SESSION_ID_CHARS, '')
    if (!sanitized) throw new Error('Invalid session ID')
    return join(this.storagePath, sanitized)
  }

  async create(options: CreateSessionOptions): Promise<Session> {
    const id = crypto.randomUUID()
    const created = new Date().toISOString()
    const meta: SessionMeta = { id, created, ...options }
    const dir = this.sessionDir(id)
    await mkdir(dir, { recursive: true })
    await Bun.write(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    return { id, meta }
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
    return parseJsonlFile<IMessage>(join(this.sessionDir(id), 'messages.jsonl'))
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
    const dir = this.sessionDir(id)
    await mkdir(dir, { recursive: true })
    const metaPath = join(dir, 'meta.json')
    const isNew = !(await Bun.file(metaPath).exists())
    if (isNew) {
      const meta: SessionMeta = { id, created: new Date().toISOString(), ...options }
      await Bun.write(metaPath, JSON.stringify(meta, null, 2))
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

    await Promise.all([...toDelete].map(id => rm(this.sessionDir(id), { recursive: true, force: true })))
  }
}

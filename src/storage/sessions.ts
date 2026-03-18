import { join } from 'path'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import type { IMessage } from '../providers/types'

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
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '')
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
    const f = Bun.file(join(this.sessionDir(id), 'messages.jsonl'))
    if (!(await f.exists())) return []
    return (await f.text())
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => { try { return JSON.parse(line) as IMessage } catch { return null } })
      .filter((msg): msg is IMessage => msg !== null)
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

  /** Ensure a session directory exists for a given ID (creates it if needed). */
  async ensureSession(id: string, options: CreateSessionOptions): Promise<string> {
    const dir = this.sessionDir(id)
    await mkdir(dir, { recursive: true })
    const metaPath = join(dir, 'meta.json')
    if (!(await Bun.file(metaPath).exists())) {
      const meta: SessionMeta = { id, created: new Date().toISOString(), ...options }
      await Bun.write(metaPath, JSON.stringify(meta, null, 2))
    }
    return id
  }

  async prune(options: PruneOptions): Promise<void> {
    const sessions = (await this.list()).sort((a, b) => new Date(a.meta.created).getTime() - new Date(b.meta.created).getTime())
    const toDelete = new Set<string>()

    if (options.ttlDays !== undefined) {
      const cutoff = Date.now() - options.ttlDays * 86_400_000
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

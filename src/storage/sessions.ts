import { join } from 'path'
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import fg from 'fast-glob'
import { fileExists, readText } from '../utils/fs'
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
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    return { id, meta }
  }

  async appendMessage(id: string, message: IMessage): Promise<void> {
    await appendFile(join(this.sessionDir(id), 'messages.jsonl'), JSON.stringify(message) + '\n')
  }

  async readMessages(id: string): Promise<IMessage[]> {
    const path = join(this.sessionDir(id), 'messages.jsonl')
    if (!(await fileExists(path))) return []
    return (await readText(path))
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => { try { return JSON.parse(line) as IMessage } catch { return null } })
      .filter((msg): msg is IMessage => msg !== null)
  }

  async list(): Promise<Session[]> {
    const sessions: Session[] = []
    const matches = await fg('*/meta.json', { cwd: this.storagePath, onlyFiles: true })
    for (const rel of matches) {
      const meta = JSON.parse(await readText(join(this.storagePath, rel))) as SessionMeta
      sessions.push({ id: meta.id, meta })
    }
    return sessions
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

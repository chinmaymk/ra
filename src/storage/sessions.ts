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
    // Sanitize to prevent path traversal (e.g., ../../etc/passwd)
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
    const dir = this.sessionDir(id)
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, 'messages.jsonl')
    const line = JSON.stringify(message) + '\n'
    await appendFile(filePath, line)
  }

  async readMessages(id: string): Promise<IMessage[]> {
    const file = join(this.sessionDir(id), 'messages.jsonl')
    const f = Bun.file(file)
    if (!(await f.exists())) return []

    const text = await f.text()
    return text
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        try { return JSON.parse(line) as IMessage }
        catch { return null }
      })
      .filter((msg): msg is IMessage => msg !== null)
  }


  async list(): Promise<Session[]> {
    const glob = new Bun.Glob('*/meta.json')
    const sessions: Session[] = []

    for await (const rel of glob.scan({ cwd: this.storagePath, onlyFiles: true })) {
      const metaFile = join(this.storagePath, rel)
      const meta = JSON.parse(await Bun.file(metaFile).text()) as SessionMeta
      sessions.push({ id: meta.id, meta })
    }

    return sessions
  }

  async prune(options: PruneOptions): Promise<void> {
    const sessions = (await this.list()).sort((a, b) => new Date(a.meta.created).getTime() - new Date(b.meta.created).getTime())
    const toDelete = new Set<string>()

    if (options.ttlDays !== undefined) {
      const cutoff = Date.now() - options.ttlDays * 86_400_000
      sessions.filter(s => new Date(s.meta.created).getTime() < cutoff).forEach(s => toDelete.add(s.id))
    }
    if (options.maxSessions !== undefined) {
      const remaining = sessions.filter(s => !toDelete.has(s.id))
      if (remaining.length > options.maxSessions) {
        remaining.slice(0, remaining.length - options.maxSessions).forEach(s => toDelete.add(s.id))
      }
    }

    await Promise.all([...toDelete].map(id => rm(this.sessionDir(id), { recursive: true, force: true })))
  }
}

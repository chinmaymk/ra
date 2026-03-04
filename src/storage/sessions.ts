import { join } from 'path'
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
    await Bun.$`mkdir -p ${this.storagePath}`.quiet()
  }

  private sessionDir(id: string): string {
    return join(this.storagePath, id)
  }

  async create(options: CreateSessionOptions): Promise<Session> {
    const id = crypto.randomUUID()
    const created = new Date().toISOString()
    const meta: SessionMeta = { id, created, ...options }

    const dir = this.sessionDir(id)
    await Bun.$`mkdir -p ${dir}`.quiet()

    await Bun.write(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))

    return { id, meta }
  }

  async appendMessage(id: string, message: IMessage): Promise<void> {
    const file = join(this.sessionDir(id), 'messages.jsonl')
    const line = JSON.stringify(message) + '\n'
    const existing = await Bun.file(file).text().catch(() => '')
    await Bun.write(file, existing + line)
  }

  async readMessages(id: string): Promise<IMessage[]> {
    const file = join(this.sessionDir(id), 'messages.jsonl')
    const f = Bun.file(file)
    if (!(await f.exists())) return []

    const text = await f.text()
    return text
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as IMessage)
  }

  async saveCheckpoint(id: string, data: Record<string, unknown>): Promise<void> {
    await Bun.write(join(this.sessionDir(id), 'checkpoint.json'), JSON.stringify(data, null, 2))
  }

  async loadCheckpoint(id: string): Promise<Record<string, unknown> | null> {
    const file = join(this.sessionDir(id), 'checkpoint.json')
    const f = Bun.file(file)
    if (!(await f.exists())) return null
    return JSON.parse(await f.text())
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
    if (options.maxSessions !== undefined && sessions.length > options.maxSessions) {
      sessions.filter(s => !toDelete.has(s.id)).slice(0, sessions.length - options.maxSessions).forEach(s => toDelete.add(s.id))
    }

    await Promise.all([...toDelete].map(id => Bun.$`rm -rf ${this.sessionDir(id)}`.quiet()))
  }
}

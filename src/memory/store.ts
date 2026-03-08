import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export interface Memory {
  id: number
  content: string
  tags: string
  layer: 'session' | 'long-term'
  sessionId: string
  createdAt: string
}

export interface MemoryStoreOptions {
  path: string
  maxSizeMB: number
  ttlDays: number            // long-term memory TTL
  sessionTTLHours: number    // session memory TTL (default: 24)
}

export class MemoryStore {
  private db: Database

  constructor(private options: MemoryStoreOptions) {
    mkdirSync(dirname(options.path), { recursive: true })
    this.db = new Database(options.path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        layer TEXT NOT NULL DEFAULT 'long-term' CHECK(layer IN ('session', 'long-term')),
        session_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        tags,
        content='memories',
        content_rowid='id'
      )
    `)
    // FTS sync triggers
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END
    `)
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
      END
    `)
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END
    `)
    // Indexes for common queries
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at)`)
  }

  /** Save a memory to a specific layer */
  save(content: string, opts: { tags?: string; layer?: 'session' | 'long-term'; sessionId?: string } = {}): Memory {
    const { tags = '', layer = 'session', sessionId = '' } = opts
    const stmt = this.db.prepare(
      `INSERT INTO memories (content, tags, layer, session_id)
       VALUES (?, ?, ?, ?)
       RETURNING id, content, tags, layer, session_id AS sessionId, created_at AS createdAt`,
    )
    return stmt.get(content, tags, layer, sessionId) as Memory
  }

  /** Full-text search across all layers or a specific layer */
  search(query: string, opts: { limit?: number; layer?: 'session' | 'long-term'; sessionId?: string } = {}): Memory[] {
    const { limit = 10, layer, sessionId } = opts
    let sql = `
      SELECT m.id, m.content, m.tags, m.layer, m.session_id AS sessionId, m.created_at AS createdAt
      FROM memories_fts f
      JOIN memories m ON m.id = f.rowid
      WHERE memories_fts MATCH ?
    `
    const params: (string | number)[] = [query]
    if (layer) { sql += ' AND m.layer = ?'; params.push(layer) }
    if (sessionId) { sql += ' AND m.session_id = ?'; params.push(sessionId) }
    sql += ' ORDER BY rank LIMIT ?'
    params.push(limit)
    return this.db.prepare(sql).all(...params) as Memory[]
  }

  /** List memories, optionally filtered by layer or session */
  list(opts: { limit?: number; layer?: 'session' | 'long-term'; sessionId?: string } = {}): Memory[] {
    const { limit = 20, layer, sessionId } = opts
    let sql = 'SELECT id, content, tags, layer, session_id AS sessionId, created_at AS createdAt FROM memories WHERE 1=1'
    const params: (string | number)[] = []
    if (layer) { sql += ' AND layer = ?'; params.push(layer) }
    if (sessionId) { sql += ' AND session_id = ?'; params.push(sessionId) }
    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)
    return this.db.prepare(sql).all(...params) as Memory[]
  }

  /** Get session memories for injection into system prompt */
  getSessionContext(sessionId: string, limit: number = 20): Memory[] {
    return this.db.prepare(
      `SELECT id, content, tags, layer, session_id AS sessionId, created_at AS createdAt
       FROM memories WHERE layer = 'session' AND session_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    ).all(sessionId, limit) as Memory[]
  }

  /** Promote a session memory to long-term */
  promote(id: number): boolean {
    return this.db.prepare("UPDATE memories SET layer = 'long-term', session_id = '' WHERE id = ? AND layer = 'session'").run(id).changes > 0
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0
  }

  /** Remove expired memories per layer TTLs */
  prune(): number {
    let deleted = 0
    // Long-term: ttlDays
    deleted += this.db.prepare(
      "DELETE FROM memories WHERE layer = 'long-term' AND created_at < datetime('now', ?)",
    ).run(`-${this.options.ttlDays} days`).changes
    // Session: sessionTTLHours
    deleted += this.db.prepare(
      "DELETE FROM memories WHERE layer = 'session' AND created_at < datetime('now', ?)",
    ).run(`-${this.options.sessionTTLHours} hours`).changes
    return deleted
  }

  /** Enforce max database size by removing oldest memories */
  enforceMaxSize(): number {
    const maxBytes = this.options.maxSizeMB * 1024 * 1024
    let deleted = 0
    while (this.dbSize() > maxBytes) {
      // Remove oldest session memories first, then long-term
      const result = this.db.prepare(
        `DELETE FROM memories WHERE id = (
          SELECT id FROM memories ORDER BY
            CASE layer WHEN 'session' THEN 0 ELSE 1 END,
            created_at ASC
          LIMIT 1
        )`,
      ).run()
      if (result.changes === 0) break
      deleted += result.changes
    }
    return deleted
  }

  dbSize(): number {
    return (this.db.prepare('SELECT page_count * page_size AS size FROM pragma_page_count, pragma_page_size').get() as { size: number }).size
  }

  count(layer?: 'session' | 'long-term'): number {
    if (layer) {
      return (this.db.prepare('SELECT COUNT(*) AS c FROM memories WHERE layer = ?').get(layer) as { c: number }).c
    }
    return (this.db.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number }).c
  }

  close(): void {
    this.db.close()
  }
}

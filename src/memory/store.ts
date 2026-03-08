import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export interface Memory {
  id: number
  content: string
  tags: string
  createdAt: string
}

export interface MemoryStoreOptions {
  path: string
  maxSizeMB: number
  ttlDays: number
}

export class MemoryStore {
  private db: Database

  constructor(private options: MemoryStoreOptions) {
    mkdirSync(dirname(options.path), { recursive: true })
    this.db = new Database(options.path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
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
    // Keep FTS in sync via triggers
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
  }

  save(content: string, tags: string = ''): Memory {
    const stmt = this.db.prepare(
      'INSERT INTO memories (content, tags) VALUES (?, ?) RETURNING id, content, tags, created_at AS createdAt',
    )
    return stmt.get(content, tags) as Memory
  }

  search(query: string, limit: number = 10): Memory[] {
    const stmt = this.db.prepare(`
      SELECT m.id, m.content, m.tags, m.created_at AS createdAt
      FROM memories_fts f
      JOIN memories m ON m.id = f.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)
    return stmt.all(query, limit) as Memory[]
  }

  list(limit: number = 20): Memory[] {
    const stmt = this.db.prepare(
      'SELECT id, content, tags, created_at AS createdAt FROM memories ORDER BY created_at DESC LIMIT ?',
    )
    return stmt.all(limit) as Memory[]
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    return result.changes > 0
  }

  /** Remove memories older than ttlDays */
  prune(): number {
    const result = this.db.prepare(
      "DELETE FROM memories WHERE created_at < datetime('now', ?)",
    ).run(`-${this.options.ttlDays} days`)
    return result.changes
  }

  /** Enforce max database size by removing oldest memories */
  enforceMaxSize(): number {
    const maxBytes = this.options.maxSizeMB * 1024 * 1024
    let deleted = 0
    while (this.dbSize() > maxBytes) {
      const result = this.db.prepare(
        'DELETE FROM memories WHERE id = (SELECT id FROM memories ORDER BY created_at ASC LIMIT 1)',
      ).run()
      if (result.changes === 0) break
      deleted += result.changes
    }
    return deleted
  }

  dbSize(): number {
    const row = this.db.prepare('SELECT page_count * page_size AS size FROM pragma_page_count, pragma_page_size').get() as { size: number }
    return row.size
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number }).c
  }

  close(): void {
    this.db.close()
  }
}

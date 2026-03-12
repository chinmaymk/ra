import { mkdirSync } from 'fs'
import { dirname } from 'path'

// Use bun:sqlite when running under Bun, node:sqlite for Node.js.
// Both share the same API surface (exec, prepare, get, all, run, close).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: new (path: string) => any
if ('Bun' in globalThis) {
  Database = require('bun:sqlite').Database
} else {
  Database = require('node:sqlite').DatabaseSync
}

export interface Memory {
  id: number
  content: string
  tags: string
  createdAt: string
}

export interface MemoryStoreOptions {
  path: string
  maxMemories: number
  ttlDays: number
}

export class MemoryStore {
  private db: any

  constructor(private options: MemoryStoreOptions) {
    mkdirSync(dirname(options.path), { recursive: true })
    this.db = new Database(options.path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, tags, content='memories', content_rowid='id'
      );
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
      END;
    `)
  }

  save(content: string, tags = ''): Memory {
    return this.db.prepare(
      'INSERT INTO memories (content, tags) VALUES (?, ?) RETURNING id, content, tags, created_at AS createdAt',
    ).get(content, tags)
  }

  search(query: string, limit = 10): Memory[] {
    if (!query) return []
    try {
      return this.db.prepare(
        'SELECT m.id, m.content, m.tags, m.created_at AS createdAt FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?',
      ).all(query, limit)
    } catch {
      return []
    }
  }

  list(limit = 20): Memory[] {
    return this.db.prepare(
      'SELECT id, content, tags, created_at AS createdAt FROM memories ORDER BY id DESC LIMIT ?',
    ).all(limit)
  }

  forget(query: string, limit = 10): number {
    if (!query) return 0
    let ids: { id: number }[]
    try {
      ids = this.db.prepare(
        'SELECT m.id FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?',
      ).all(query, limit)
    } catch {
      return 0
    }
    if (ids.length === 0) return 0
    this.db.prepare(`DELETE FROM memories WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids.map(r => r.id))
    return ids.length
  }

  prune(): void {
    this.db.prepare("DELETE FROM memories WHERE created_at < datetime('now', ?)").run(`-${this.options.ttlDays} days`)
  }

  trim(): void {
    const excess = this.count() - this.options.maxMemories
    if (excess <= 0) return
    this.db.prepare('DELETE FROM memories WHERE id IN (SELECT id FROM memories ORDER BY id ASC LIMIT ?)').run(excess)
  }

  count(): number {
    return this.db.prepare('SELECT COUNT(*) AS c FROM memories').get().c
  }

  close(): void {
    this.db.close()
  }
}

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'

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
  logger?: Logger
}

export class MemoryStore {
  private db: Database
  private logger: Logger

  constructor(private options: MemoryStoreOptions) {
    this.logger = options.logger ?? new NoopLogger()
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
    const memory = this.db.prepare(
      'INSERT INTO memories (content, tags) VALUES (?, ?) RETURNING id, content, tags, created_at AS createdAt',
    ).get(content, tags) as Memory
    this.logger.debug('memory saved', { id: memory.id, tags, contentLength: content.length })
    return memory
  }

  search(query: string, limit = 10): Memory[] {
    if (!query) return []
    try {
      const results = this.db.prepare(
        'SELECT m.id, m.content, m.tags, m.created_at AS createdAt FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?',
      ).all(query, limit) as Memory[]
      this.logger.debug('memory search', { query, limit, resultCount: results.length })
      return results
    } catch (err) {
      this.logger.warn('memory search failed', { query, error: err instanceof Error ? err.message : String(err) })
      return []
    }
  }

  list(limit = 20): Memory[] {
    return this.db.prepare(
      'SELECT id, content, tags, created_at AS createdAt FROM memories ORDER BY id DESC LIMIT ?',
    ).all(limit) as Memory[]
  }

  deleteById(id: number): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    return result.changes > 0
  }

  forget(query: string, limit = 10): number {
    if (!query) return 0
    let ids: { id: number }[]
    try {
      ids = this.db.prepare(
        'SELECT m.id FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?',
      ).all(query, limit) as { id: number }[]
    } catch (err) {
      this.logger.warn('memory forget search failed', { query, error: err instanceof Error ? err.message : String(err) })
      return 0
    }
    if (ids.length === 0) return 0
    this.db.prepare(`DELETE FROM memories WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids.map(r => r.id))
    this.logger.info('memories forgotten', { query, count: ids.length })
    return ids.length
  }

  prune(): void {
    const before = this.count()
    this.db.prepare("DELETE FROM memories WHERE created_at < datetime('now', ?)").run(`-${this.options.ttlDays} days`)
    const pruned = before - this.count()
    if (pruned > 0) this.logger.info('memories pruned by ttl', { pruned, ttlDays: this.options.ttlDays })
  }

  trim(): void {
    const excess = this.count() - this.options.maxMemories
    if (excess <= 0) return
    this.db.prepare('DELETE FROM memories WHERE id IN (SELECT id FROM memories ORDER BY id ASC LIMIT ?)').run(excess)
    this.logger.info('memories trimmed', { trimmed: excess, maxMemories: this.options.maxMemories })
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number }).c
  }

  close(): void {
    this.db.close()
  }
}

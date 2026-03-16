/**
 * SessionMemoryStore — ephemeral in-memory key-value store scoped to a single session.
 * Survives context compaction (re-injected each turn via middleware).
 * Useful as a scratchpad, plan tracker, or state that outlives compaction.
 */
export class SessionMemoryStore {
  private data = new Map<string, string>()

  get(key: string): string | undefined {
    return this.data.get(key)
  }

  set(key: string, value: string): void {
    this.data.set(key, value)
  }

  delete(key: string): boolean {
    return this.data.delete(key)
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  entries(): Record<string, string> {
    return Object.fromEntries(this.data)
  }

  keys(): string[] {
    return [...this.data.keys()]
  }

  size(): number {
    return this.data.size
  }

  clear(): void {
    this.data.clear()
  }
}

/** Sets a deeply nested value at a dot-path without clobbering sibling keys. */
export function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    if (cur[key] === undefined || typeof cur[key] !== 'object') cur[key] = {}
    cur = cur[key] as Record<string, unknown>
  }
  cur[path[path.length - 1]!] = value
}

export function safeParseInt(value: string): number | undefined {
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? undefined : n
}

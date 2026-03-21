/** Set a deeply nested value at a dot-path without clobbering sibling keys. */
export function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as string
    if (cur[key] === undefined || typeof cur[key] !== 'object') cur[key] = {}
    cur = cur[key] as Record<string, unknown>
  }
  cur[path[path.length - 1] as string] = value
}

/** Parse an integer from a string, returning undefined on failure. */
export function safeParseInt(value: string): number | undefined {
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? undefined : n
}

export type CoercionRule =
  | { type: 'string'; path: string[] }
  | { type: 'int'; path: string[] }
  | { type: 'bool'; path: string[]; value?: unknown }
  | { type: 'csv'; path: string[] }
  | { type: 'enum'; path: string[]; values: string[] }

/** Apply a typed coercion rule to a string value, writing the result into target. */
export function applyRule(target: Record<string, unknown>, rule: CoercionRule, val: string | boolean): void {
  switch (rule.type) {
    case 'string': setPath(target, rule.path, val); break
    case 'int': { const n = safeParseInt(val as string); if (n !== undefined) setPath(target, rule.path, n); break }
    case 'bool': setPath(target, rule.path, rule.value ?? (val === true || val === 'true')); break
    case 'csv': setPath(target, rule.path, (val as string).split(',').filter(Boolean)); break
    case 'enum': if ('values' in rule && rule.values.includes(val as string)) setPath(target, rule.path, val); break
  }
}

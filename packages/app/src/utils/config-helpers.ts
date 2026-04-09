/** Type guard for plain (non-array, non-null) objects. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

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

/**
 * Docker Compose–style `${VAR}` interpolation for config files.
 *
 *   ${VAR}            — required; throws if unset
 *   ${VAR:-default}   — use default if unset OR empty string
 *   ${VAR-default}    — use default if unset (empty string is kept)
 *
 * This only runs on values loaded from `ra.config.{yaml,yml,json,toml}`
 * and recipes — defaults are plain literal TypeScript, and CLI args
 * come through yargs's own `RA_*` env-var path.
 */
const ENV_VAR_RE = /\$\{([^}:!-]+)(?::?(-)([^}]*))?\}/g

/** Interpolate `${VAR}` references inside a single string. */
export function interpolateString(value: string, env: Record<string, string | undefined>): string {
  return value.replace(ENV_VAR_RE, (_match, name: string, dashFlag: string | undefined, fallback: string | undefined) => {
    const envVal = env[name]
    // ${VAR-default}: use default only when unset (empty string is kept as-is)
    if (dashFlag === '-' && !_match.includes(':-')) {
      return envVal !== undefined ? envVal : (fallback ?? '')
    }
    // ${VAR:-default}: use default when unset OR empty
    if (dashFlag === '-' && _match.includes(':-')) {
      return envVal !== undefined && envVal !== '' ? envVal : (fallback ?? '')
    }
    // ${VAR}: required — throw if not set
    if (envVal === undefined) {
      throw new Error(`Environment variable "${name}" is required but not set`)
    }
    return envVal
  })
}

/**
 * Recursively walk a parsed config object and interpolate all string leaves
 * that contain `${...}` references. Arrays and nested objects are traversed.
 * Non-string leaves pass through untouched.
 */
export function interpolateEnvVars(obj: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof obj === 'string') {
    return obj.includes('${') ? interpolateString(obj, env) : obj
  }
  if (Array.isArray(obj)) return obj.map(item => interpolateEnvVars(item, env))
  if (isPlainObject(obj)) {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) result[key] = interpolateEnvVars(val, env)
    return result
  }
  return obj
}

/**
 * Coerce interpolated string leaves to match the types of a schema object.
 * YAML parsers read `port: ${PORT}` as a string, but the resolved config
 * expects a number — so after interpolation we walk both trees in parallel
 * and convert string values whose schema counterpart is numeric or boolean.
 *
 * Only runs on file/recipe values. Defaults and CLI args are already typed.
 */
export function coerceTypes(obj: unknown, schema: unknown): unknown {
  if (obj === null || obj === undefined || schema === null || schema === undefined) return obj

  if (typeof schema === 'number' && typeof obj === 'string') {
    const n = Number(obj)
    return Number.isNaN(n) ? obj : n
  }
  if (typeof schema === 'boolean' && typeof obj === 'string') {
    if (obj === 'true') return true
    if (obj === 'false') return false
    return obj
  }
  if (Array.isArray(obj) && Array.isArray(schema)) {
    const itemSchema = schema[0]
    return itemSchema !== undefined ? obj.map(item => coerceTypes(item, itemSchema)) : obj
  }
  if (isPlainObject(obj) && isPlainObject(schema)) {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      result[key] = key in schema ? coerceTypes(val, schema[key]) : val
    }
    return result
  }
  return obj
}


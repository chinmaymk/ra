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
 * Regex matching Docker Compose–style variable references:
 *   ${VAR}            — required, errors if unset
 *   ${VAR:-default}   — use default if unset or empty
 *   ${VAR-default}    — use default if unset (empty string is kept)
 */
const ENV_VAR_RE = /\$\{([^}:!-]+)(?::?(-)([^}]*))?\}/g

/**
 * Interpolate a single string, replacing `${VAR}` references with values from `env`.
 * Returns the original string (with substitutions) or throws if a required variable is missing.
 */
export function interpolateString(
  value: string,
  env: Record<string, string | undefined>,
): string {
  return value.replace(ENV_VAR_RE, (_match, name: string, dashFlag: string | undefined, fallback: string | undefined) => {
    const envVal = env[name]

    // ${VAR-default}: use default only when unset (empty string is kept)
    if (dashFlag === '-' && !_match.includes(':-')) {
      return envVal !== undefined ? envVal : (fallback ?? '')
    }

    // ${VAR:-default}: use default when unset OR empty
    if (dashFlag === '-' && _match.includes(':-')) {
      return (envVal !== undefined && envVal !== '') ? envVal : (fallback ?? '')
    }

    // ${VAR}: required — error if not set
    if (envVal === undefined) {
      throw new Error(`Environment variable "${name}" is required but not set`)
    }
    return envVal
  })
}

/**
 * Recursively walk a parsed config object and interpolate all string values
 * that contain `${...}` references. Arrays and nested objects are traversed.
 * Non-string leaves are returned as-is.
 */
export function interpolateEnvVars(
  obj: unknown,
  env: Record<string, string | undefined>,
): unknown {
  if (typeof obj === 'string') {
    return obj.includes('${') ? interpolateString(obj, env) : obj
  }
  if (Array.isArray(obj)) {
    return obj.map(item => interpolateEnvVars(item, env))
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = interpolateEnvVars(val, env)
    }
    return result
  }
  return obj
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Coerce interpolated string values to match the types in a schema object.
 * After `${}` interpolation, values like `"3000"` or `"true"` may be strings
 * where the schema expects numbers or booleans. This walks both trees in
 * parallel and converts string values when the schema type is number or boolean.
 */
export function coerceTypes(obj: unknown, schema: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (schema === null || schema === undefined) return obj

  // String → number coercion
  if (typeof schema === 'number' && typeof obj === 'string') {
    const n = Number(obj)
    return Number.isNaN(n) ? obj : n
  }

  // String → boolean coercion
  if (typeof schema === 'boolean' && typeof obj === 'string') {
    if (obj === 'true') return true
    if (obj === 'false') return false
    return obj
  }

  // Recurse into arrays (coerce each element against schema[0] if available)
  if (Array.isArray(obj) && Array.isArray(schema)) {
    const itemSchema = schema[0]
    return itemSchema !== undefined
      ? obj.map(item => coerceTypes(item, itemSchema))
      : obj
  }

  // Recurse into plain objects
  if (isPlainObj(obj) && isPlainObj(schema)) {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      result[key] = key in schema ? coerceTypes(val, schema[key]) : val
    }
    return result
  }

  return obj
}

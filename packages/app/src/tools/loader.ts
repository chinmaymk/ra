import { basename } from 'path'
import { looksLikePath, resolvePath } from '../utils/paths'
import { errorMessage, NoopLogger } from '@chinmaymk/ra'
import type { Logger, ITool } from '@chinmaymk/ra'

/** Simplified parameter definition — avoids raw JSON Schema boilerplate. */
export interface ParameterDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  optional?: boolean
  /** Only for array types — describes each element. */
  items?: Record<string, unknown>
  /** Only for object types — nested properties. */
  properties?: Record<string, unknown>
  /** Enum constraint — restrict to specific values. */
  enum?: unknown[]
  /** Default value. */
  default?: unknown
}

/** Convert simplified `parameters` map to JSON Schema `inputSchema`. */
export function buildInputSchema(parameters: Record<string, ParameterDef>): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const [key, def] of Object.entries(parameters)) {
    const { optional, ...rest } = def
    properties[key] = rest
    if (!optional) required.push(key)
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
  }
}

/** Derive a PascalCase tool name from a filename (e.g. "search-files.ts" → "SearchFiles"). */
function nameFromFile(filePath: string): string {
  return basename(filePath)
    .replace(/\.[^.]+$/, '')             // strip extension
    .split(/[-_]+/)                      // split on hyphens/underscores
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))  // capitalize each segment
    .join('')
}

/** Infer a tool name from a function, falling back to filename. */
function inferName(fn: Function | undefined, source: string): string {
  const fnName = fn?.name
  if (fnName && fnName !== 'default' && fnName !== 'anonymous' && fnName !== 'execute') {
    return fnName.charAt(0).toUpperCase() + fnName.slice(1)
  }
  return nameFromFile(source)
}

/** Apply parameters shorthand and name inference to a tool-like object. */
function enrichTool(obj: Record<string, unknown>, source: string): void {
  if (obj.parameters && !obj.inputSchema) {
    obj.inputSchema = buildInputSchema(obj.parameters as Record<string, ParameterDef>)
  }
  if (!obj.name) {
    obj.name = inferName(obj.execute as Function | undefined, source)
  }
}

/** Build an ITool from module exports, inferring what we can. */
function buildTool(mod: Record<string, unknown>, source: string): ITool {
  const exported = mod.default

  // ── Full ITool object export ────────────────────────────────────
  if (exported && typeof exported === 'object' && !Array.isArray(exported)) {
    const obj = exported as Record<string, unknown>
    enrichTool(obj, source)
    return validateTool(obj, source)
  }

  // ── Factory function: returns an ITool-like object ─────────────
  // Distinguish from execute function: a factory returns an object with `execute`
  if (typeof exported === 'function') {
    // Check if module has `description` export → named-exports pattern (default is execute fn)
    if (typeof mod.description === 'string') {
      return buildFromNamedExports(mod, exported, source)
    }
    // Otherwise treat as factory
    const result = exported()
    if (!result || typeof result !== 'object') {
      throw new Error(`Factory function in "${source}" must return a tool object`)
    }
    const obj = result as Record<string, unknown>
    enrichTool(obj, source)
    if (!obj.name) {
      obj.name = inferName(exported, source)
    }
    return validateTool(obj, source)
  }

  // ── Named exports: no default, but has description + execute ───
  if (exported === undefined && typeof mod.description === 'string') {
    const execute = mod.execute
    if (typeof execute !== 'function') {
      throw new Error(`Tool file "${source}" has a "description" export but no default function or "execute" export`)
    }
    return buildFromNamedExports(mod, execute as (...args: unknown[]) => unknown, source)
  }

  throw new Error(`Tool file "${source}" must have a default export (object or function) or named exports (description + default function)`)
}

/** Build a tool from the named-exports pattern. */
function buildFromNamedExports(mod: Record<string, unknown>, execute: Function, source: string): ITool {
  const description = mod.description as string

  const name = (typeof mod.name === 'string' && mod.name)
    ? mod.name
    : inferName(execute, source)

  let inputSchema: Record<string, unknown>
  if (mod.parameters) {
    inputSchema = buildInputSchema(mod.parameters as Record<string, ParameterDef>)
  } else if (mod.inputSchema && typeof mod.inputSchema === 'object') {
    inputSchema = mod.inputSchema as Record<string, unknown>
  } else {
    inputSchema = { type: 'object', properties: {} }
  }

  const timeout = typeof mod.timeout === 'number' ? mod.timeout : undefined
  return { name, description, inputSchema, execute: execute as ITool['execute'], ...(timeout !== undefined && { timeout }) }
}

/** Validate that an object has all required ITool fields. */
function validateTool(tool: unknown, source: string): ITool {
  if (!tool || typeof tool !== 'object') {
    throw new Error(`Tool from "${source}" must be an object with { name, description, inputSchema, execute }`)
  }
  const t = tool as Record<string, unknown>
  if (typeof t.name !== 'string' || !t.name) {
    throw new Error(`Tool from "${source}" is missing a "name" string`)
  }
  if (typeof t.description !== 'string') {
    throw new Error(`Tool "${t.name}" from "${source}" is missing a "description" string`)
  }
  if (!t.inputSchema || typeof t.inputSchema !== 'object') {
    throw new Error(`Tool "${t.name}" from "${source}" is missing an "inputSchema" object`)
  }
  if (typeof t.execute !== 'function') {
    throw new Error(`Tool "${t.name}" from "${source}" is missing an "execute" function`)
  }
  return tool as ITool
}

/** Load a single tool from a file path. */
async function loadOne(entry: string, cwd: string): Promise<ITool> {
  if (!looksLikePath(entry)) {
    throw new Error(`Tool entry must be a file path (got: "${entry}")`)
  }
  const resolved = resolvePath(entry, cwd)
  let mod: Record<string, unknown>
  try {
    mod = await import(resolved)
  } catch (err) {
    throw new Error(`Failed to import tool file "${resolved}": ${errorMessage(err)}`)
  }
  return buildTool(mod, resolved)
}

/** Load custom tools from file paths specified in config. */
export async function loadCustomTools(
  entries: string[],
  cwd: string,
  logger?: Logger,
): Promise<ITool[]> {
  const log = logger ?? new NoopLogger()
  if (entries.length === 0) return []

  const tools = await Promise.all(entries.map(e => loadOne(e, cwd)))
  log.info('custom tools loaded', { count: tools.length, tools: tools.map(t => t.name) })
  return tools
}

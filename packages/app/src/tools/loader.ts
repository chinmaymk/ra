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

/** Validate that an object has all required ITool fields. */
function validateTool(tool: Record<string, unknown>, source: string): ITool {
  if (typeof tool.name !== 'string' || !tool.name) {
    throw new Error(`Tool from "${source}" is missing a "name" string`)
  }
  if (typeof tool.description !== 'string') {
    throw new Error(`Tool "${tool.name}" from "${source}" is missing a "description" string`)
  }
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
    throw new Error(`Tool "${tool.name}" from "${source}" is missing an "inputSchema" object`)
  }
  if (typeof tool.execute !== 'function') {
    throw new Error(`Tool "${tool.name}" from "${source}" is missing an "execute" function`)
  }
  return tool as unknown as ITool
}

/** Load a single tool from a file path. Default export must be an ITool object or a factory returning one. Supports `parameters` shorthand in place of `inputSchema`. */
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

  const exported = mod.default
  if (exported === undefined) {
    throw new Error(`Tool file "${resolved}" must have a default export`)
  }

  // Factory function: call it to get the tool object
  const raw = typeof exported === 'function' ? exported() : exported

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Tool from "${resolved}" must export an object with { name, description, execute }`)
  }

  const obj = raw as Record<string, unknown>

  // Convert parameters shorthand → inputSchema
  if (obj.parameters && !obj.inputSchema) {
    obj.inputSchema = buildInputSchema(obj.parameters as Record<string, ParameterDef>)
  }

  return validateTool(obj, resolved)
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

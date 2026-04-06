import { looksLikePath, resolvePath } from '../utils/paths'
import { importFresh } from '../utils/import-fresh'
import { errorMessage, NoopLogger } from '@chinmaymk/ra'
import type { Logger, ITool } from '@chinmaymk/ra'
import { hasShellPrefix, isShellPath } from '../shell'
import { createShellTool } from './shell-tool'

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
  const fields: string[] = []
  if (typeof tool.name !== 'string' || !tool.name) fields.push('"name" (string)')
  if (typeof tool.description !== 'string') fields.push('"description" (string)')
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') fields.push('"inputSchema" (object)')
  if (typeof tool.execute !== 'function') fields.push('"execute" (function)')
  if (fields.length > 0) {
    const toolId = typeof tool.name === 'string' && tool.name ? `Tool "${tool.name}"` : 'Tool'
    throw new Error(`${toolId} from "${source}" is missing required fields: ${fields.join(', ')}. A custom tool must export { name, description, inputSchema, execute }.`)
  }
  return tool as unknown as ITool
}

/** Load a single tool from a file path or shell entry. */
async function loadOne(entry: string, cwd: string, logger: Logger): Promise<ITool> {
  // Shell script tools: shell: prefix or auto-detected script extension
  if (hasShellPrefix(entry) || isShellPath(entry)) {
    return createShellTool(entry, cwd, logger)
  }

  if (!looksLikePath(entry)) {
    throw new Error(`Custom tool entry "${entry}" is not a valid file path. Entries must be relative or absolute paths to .ts/.js files.`)
  }
  const resolved = resolvePath(entry, cwd)
  let mod: Record<string, unknown>
  try {
    mod = await importFresh(resolved)
  } catch (err) {
    const detail = errorMessage(err)
    if (detail.includes('Cannot find module') || detail.includes('ENOENT') || detail.includes('not found')) {
      throw new Error(`Custom tool file not found: "${resolved}". Check the path in your config.`)
    }
    throw new Error(`Failed to import custom tool "${resolved}": ${detail}`)
  }

  const exported = mod.default
  if (exported === undefined) {
    throw new Error(`Custom tool file "${resolved}" has no default export. The file must export a tool object or factory function as its default export.`)
  }

  // Factory function: call it to get the tool object (supports async factories)
  const raw = typeof exported === 'function' ? await exported() : exported

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Custom tool "${resolved}" default export must be an object with { name, description, inputSchema, execute }, got ${typeof raw}.`)
  }

  const obj = raw as Record<string, unknown>

  // Convert parameters shorthand → inputSchema
  if (obj.parameters && !obj.inputSchema) {
    obj.inputSchema = buildInputSchema(obj.parameters as Record<string, ParameterDef>)
    delete obj.parameters
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

  const results = await Promise.allSettled(entries.map(e => loadOne(e, cwd, log)))
  const tools: ITool[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled') {
      tools.push(result.value)
    } else {
      log.error('failed to load custom tool', { file: entries[i], error: errorMessage(result.reason) })
    }
  }
  if (tools.length > 0) {
    log.info('custom tools loaded', { count: tools.length, tools: tools.map(t => t.name) })
  }
  return tools
}

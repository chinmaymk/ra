import { looksLikePath, resolvePath } from '../utils/paths'
import { errorMessage, NoopLogger } from '@chinmaymk/ra'
import type { Logger, ITool } from '@chinmaymk/ra'

/** Validate that an object looks like a valid ITool. */
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

/** Load a single tool from a file path. The default export can be an ITool object or a factory function returning one. */
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
  if (typeof exported === 'function') {
    const result = exported()
    return validateTool(result, resolved)
  }

  // Direct object export
  return validateTool(exported, resolved)
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

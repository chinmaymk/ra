/**
 * Shell script tools — run a script as an ITool.
 *
 * Scripts self-describe by outputting JSON when called with `--describe`:
 * ```bash
 * #!/bin/bash
 * if [ "$1" = "--describe" ]; then
 *   cat << 'EOF'
 *   { "name": "MyTool", "description": "Does something", "parameters": {
 *       "query": { "type": "string", "description": "Search query" }
 *   }}
 *   EOF
 *   exit 0
 * fi
 * read -r input
 * echo "result: $(echo "$input" | jq -r '.query')"
 * ```
 *
 * **--describe stdout**: JSON `{ name, description, inputSchema | parameters }`
 * **execute stdin**: JSON tool input (the arguments from the model)
 * **execute stdout**: tool result (returned as-is to the model)
 * **execute stderr**: logged at debug level
 * **execute exit code**: non-zero becomes an error result
 */
import { execFile } from 'node:child_process'
import { parseShellEntry, resolveCommand, runShellProcess } from '../shell'
import { resolvePath } from '../utils/paths'
import { buildInputSchema, type ParameterDef } from './loader'
import type { ITool, Logger } from '@chinmaymk/ra'

/** Run a command synchronously-ish to get the --describe output. */
function describeScript(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args, '--describe'], { cwd, timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr?.trim() ? `\n  stderr: ${stderr.trim().slice(0, 500)}` : ''
        reject(new Error(`Shell tool "${command}" --describe failed: ${error.message}${detail}`))
        return
      }
      resolve(stdout)
    })
  })
}

interface ShellToolDescriptor {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  parameters?: Record<string, ParameterDef>
  timeout?: number
}

/** Validate and normalize the descriptor from --describe output. */
function parseDescriptor(raw: string, source: string): ShellToolDescriptor {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error(`Shell tool "${source}" --describe produced no output`)

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    throw new Error(`Shell tool "${source}" --describe produced invalid JSON: ${trimmed.slice(0, 200)}`)
  }

  if (typeof obj.name !== 'string' || !obj.name) {
    throw new Error(`Shell tool "${source}" --describe is missing a "name" string`)
  }
  if (typeof obj.description !== 'string') {
    throw new Error(`Shell tool "${source}" --describe is missing a "description" string`)
  }

  // Convert parameters shorthand → inputSchema
  if (obj.parameters && !obj.inputSchema) {
    obj.inputSchema = buildInputSchema(obj.parameters as Record<string, ParameterDef>)
  }

  if (!obj.inputSchema || typeof obj.inputSchema !== 'object') {
    // Default to empty object schema if not provided
    obj.inputSchema = { type: 'object', properties: {} }
  }

  return obj as unknown as ShellToolDescriptor
}

/**
 * Load a shell script as an ITool.
 *
 * Accepts either:
 * - `shell: <command> [args...]` — explicit shell prefix
 * - `./path/to/script.sh` — auto-detected script path
 *
 * The script must support `--describe` to output its tool definition.
 */
export async function createShellTool(
  entry: string,
  cwd: string,
  logger: Logger,
): Promise<ITool> {
  let command: string
  let args: string[]

  if (entry.startsWith('shell:')) {
    const parsed = parseShellEntry(entry)
    command = parsed.command
    args = parsed.args
  } else {
    // Direct path — resolve it
    command = resolvePath(entry, cwd)
    args = []
  }

  const resolvedCommand = resolveCommand(command, cwd)
  const describeOutput = await describeScript(resolvedCommand, args, cwd)
  const descriptor = parseDescriptor(describeOutput, entry)

  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema!,
    ...(descriptor.timeout !== undefined && { timeout: descriptor.timeout }),
    async execute(input: unknown) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 120_000)

      try {
        const payload = JSON.stringify(input ?? {})
        const { stdout, stderr, exitCode } = await runShellProcess(
          resolvedCommand, args, payload, cwd, ac.signal, logger,
        )

        if (exitCode !== 0) {
          const detail = stderr.trim() ? `\n${stderr.trim().slice(0, 1000)}` : ''
          throw new Error(`Script exited with code ${exitCode}${detail}`)
        }

        return stdout.trim() || '(no output)'
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

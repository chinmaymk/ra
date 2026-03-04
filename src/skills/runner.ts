import { join } from 'path'
import type { IMessage } from '../providers/types'
import type { Skill } from './types'

/**
 * Parse the shebang binary from the first line of a script.
 * #!/usr/bin/env node  -> 'node'
 * #!/usr/bin/bun       -> 'bun'
 * Returns null if no shebang present.
 */
function parseShebang(content: string): string | null {
  const firstLine = content.split('\n')[0] ?? ''
  if (!firstLine.startsWith('#!')) return null
  const parts = firstLine.slice(2).trim().split(/\s+/)
  if (parts[0]?.endsWith('env') && parts[1]) return parts[1]
  return parts[0]?.split('/').pop() ?? null
}

/**
 * Find the first available binary from candidates via Bun.which.
 * Throws if none found.
 */
function findRuntime(candidates: string[]): string {
  for (const c of candidates) {
    if (Bun.which(c)) return c
  }
  throw new Error(`None of [${candidates.join(', ')}] found on PATH`)
}

/**
 * Build the subprocess command for a given runtime and script path.
 */
function buildCmd(runtime: string, scriptPath: string): string[] {
  switch (runtime) {
    case 'deno': return ['deno', 'run', scriptPath]
    case 'bun':  return ['bun', 'run', scriptPath]
    case 'go':   return ['go', 'run', scriptPath]
    default:     return [runtime, scriptPath]
  }
}

/**
 * Resolve the command to run a script.
 * Shebang takes priority; falls back to extension-based defaults.
 */
async function resolveCmd(scriptPath: string): Promise<string[]> {
  const content = await Bun.file(scriptPath).text()
  const shebang = parseShebang(content)
  if (shebang) return buildCmd(shebang, scriptPath)

  const ext = scriptPath.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'sh':  return ['sh', scriptPath]
    case 'py':  return buildCmd(findRuntime(['python3', 'python']), scriptPath)
    case 'go':  return ['go', 'run', scriptPath]
    case 'js':
    case 'ts':  return buildCmd(findRuntime(['bun', 'node', 'deno']), scriptPath)
    default:    throw new Error(`Unsupported script extension: .${ext ?? ''}`)
  }
}

export async function runSkillScript(scriptPath: string, env: Record<string, string>): Promise<string> {
  const cmd = await resolveCmd(scriptPath)
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  const [output, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])

  if (exitCode !== 0) {
    throw new Error(`Script exited with code ${exitCode}: ${(await new Response(proc.stderr).text()).trim()}`)
  }
  return output
}

export async function buildSkillMessages(skill: Skill, env: Record<string, string>): Promise<IMessage[]> {
  const messages: IMessage[] = [{ role: 'user', content: skill.body }]
  for (const rel of skill.scripts) {
    const output = await runSkillScript(join(skill.dir, rel), env)
    if (output.trim()) messages.push({ role: 'user', content: output })
  }
  return messages
}

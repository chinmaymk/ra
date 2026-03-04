import { join } from 'path'
import { chmodSync, statSync } from 'fs'
import type { IMessage } from '../providers/types'
import type { Skill } from './types'

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
 * Check if a file has a shebang line.
 */
function hasShebang(content: string): boolean {
  return content.startsWith('#!')
}

/**
 * Ensure a file is executable (adds +x if needed).
 */
function ensureExecutable(scriptPath: string): void {
  const stat = statSync(scriptPath)
  if (!(stat.mode & 0o111)) {
    chmodSync(scriptPath, stat.mode | 0o755)
  }
}

/**
 * Resolve the command to run a script.
 * Files with shebangs are run directly (OS handles interpreter selection).
 * Otherwise, extension-based detection picks the runtime.
 */
async function resolveCmd(scriptPath: string): Promise<string[]> {
  const content = await Bun.file(scriptPath).text()

  if (hasShebang(content)) {
    ensureExecutable(scriptPath)
    return [scriptPath]
  }

  const ext = scriptPath.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'sh':  return [findRuntime(['bash', 'sh']), scriptPath]
    case 'py':  return buildCmd(findRuntime(['python3', 'python']), scriptPath)
    case 'go':  return ['go', 'run', scriptPath]
    case 'js':
    case 'ts': {
      try {
        return buildCmd(findRuntime(['bun', 'node', 'deno']), scriptPath)
      } catch {
        return [process.execPath, '--exec', scriptPath]
      }
    }
    default:    throw new Error(`Unsupported script extension: .${ext ?? ''}`)
  }
}

export async function runSkillScript(scriptPath: string, env: Record<string, string>): Promise<string> {
  const cmd = await resolveCmd(scriptPath)
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  const [output, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`Script exited with code ${exitCode}: ${stderrText.trim()}`)
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

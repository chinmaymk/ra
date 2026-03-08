import { join, basename, extname } from 'path'
import { resolveSkillAsset, type Skill } from './types'

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
 * Uses extension-based detection to pick the runtime.
 * Shell scripts and files with shebangs are run via bash/sh.
 */
async function resolveCmd(scriptPath: string): Promise<string[]> {
  const content = await Bun.file(scriptPath).text()
  const shell = () => findRuntime(['bash', 'sh'])

  if (content.startsWith('#!')) {
    const shebangLine = content.split('\n')[0]!.slice(2).trim()
    const parts = shebangLine.split(/\s+/)
    const interpreter = parts[0]?.endsWith('/env') && parts[1] ? parts[1] : parts[0]!
    return [interpreter, scriptPath]
  }

  const ext = extname(scriptPath).slice(1).toLowerCase() || null

  switch (ext) {
    case null:  return [shell(), scriptPath]
    case 'sh':  return [shell(), scriptPath]
    case 'py':  return buildCmd(findRuntime(['python3', 'python']), scriptPath)
    case 'go':  return buildCmd(findRuntime(['go']), scriptPath)
    case 'js':
    case 'ts': {
      try {
        return buildCmd(findRuntime(['bun', 'node', 'deno']), scriptPath)
      } catch {
        return [process.execPath, '--exec', scriptPath]
      }
    }
    default:    throw new Error(`Unsupported script extension: .${ext}`)
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

/**
 * Run a specific script from a skill by name (on-demand).
 * Accepts either "scripts/run.ts" or just "run.ts".
 */
export async function runSkillScriptByName(skill: Skill, scriptName: string, env: Record<string, string>): Promise<string> {
  const rel = resolveSkillAsset(skill.scripts, scriptName, 'scripts')
  if (!rel) throw new Error(`Script not found: ${scriptName} in skill ${skill.metadata.name}`)
  return runSkillScript(join(skill.dir, rel), env)
}

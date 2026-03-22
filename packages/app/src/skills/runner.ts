import { join, extname } from 'path'
import { NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import { resolveSkillAsset, type Skill } from './types'

function findRuntime(candidates: string[]): string {
  for (const c of candidates) {
    if (Bun.which(c)) return c
  }
  throw new Error(`None of [${candidates.join(', ')}] found on PATH`)
}

// Extension → runtime candidates. 'run' runtimes use `[rt, 'run', path]`, others use `[rt, path]`.
const RUN_CMD = new Set(['deno', 'bun', 'go'])
const RUNTIMES: Record<string, string[]> = {
  sh: ['bash', 'sh'],
  py: ['python3', 'python'],
  go: ['go'],
  js: ['bun', 'node', 'deno'],
  ts: ['bun', 'node', 'deno'],
}

async function resolveCmd(scriptPath: string): Promise<string[]> {
  const content = await Bun.file(scriptPath).text()

  // Shebang takes precedence
  if (content.startsWith('#!')) {
    const parts = (content.split('\n')[0] ?? '').slice(2).trim().split(/\s+/)
    const interpreter = parts[0]?.endsWith('/env') && parts[1] ? parts[1] : (parts[0] ?? 'sh')
    return [interpreter, scriptPath]
  }

  const ext = extname(scriptPath).slice(1).toLowerCase()
  const candidates = RUNTIMES[ext || 'sh']
  if (!candidates) throw new Error(`Unsupported script extension: .${ext}`)

  try {
    const rt = findRuntime(candidates)
    return RUN_CMD.has(rt) ? [rt, 'run', scriptPath] : [rt, scriptPath]
  } catch {
    // JS/TS fallback: use the current process as an --exec runner
    if (ext === 'js' || ext === 'ts') return [process.execPath, '--exec', scriptPath]
    throw new Error(`No runtime found for .${ext} files`)
  }
}

export async function runSkillScript(scriptPath: string, env: Record<string, string>, logger?: Logger): Promise<string> {
  const log = logger ?? new NoopLogger()
  const cmd = await resolveCmd(scriptPath)
  log.debug('skill script starting', { scriptPath, runtime: cmd[0] })
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  const [output, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    log.error('skill script failed', { scriptPath, exitCode, stderr: stderrText.trim().slice(0, 200) })
    throw new Error(`Script exited with code ${exitCode}: ${stderrText.trim()}`)
  }
  log.info('skill script completed', { scriptPath, exitCode, outputLength: output.length })
  return output
}

export async function runSkillScriptByName(skill: Skill, scriptName: string, env: Record<string, string>, logger?: Logger): Promise<string> {
  const rel = resolveSkillAsset(skill.scripts, scriptName, 'scripts')
  if (!rel) throw new Error(`Script not found: ${scriptName} in skill ${skill.metadata.name}`)
  return runSkillScript(join(skill.dir, rel), env, logger)
}

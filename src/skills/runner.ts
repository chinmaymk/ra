import { join, extname } from 'path'
import { spawn as nodeSpawn, execFileSync } from 'node:child_process'
import { readText } from '../utils/fs'
import { resolveSkillAsset, type Skill } from './types'

function findRuntime(candidates: string[]): string {
  for (const c of candidates) {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(cmd, [c], { stdio: 'pipe' })
      return c
    } catch { /* not found */ }
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
  const content = await readText(scriptPath)

  // Shebang takes precedence
  if (content.startsWith('#!')) {
    const parts = content.split('\n')[0]!.slice(2).trim().split(/\s+/)
    const interpreter = parts[0]?.endsWith('/env') && parts[1] ? parts[1] : parts[0]!
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

export async function runSkillScript(scriptPath: string, env: Record<string, string>): Promise<string> {
  const cmd = await resolveCmd(scriptPath)
  return new Promise<string>((resolve, reject) => {
    const proc = nodeSpawn(cmd[0]!, cmd.slice(1), {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout!.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Script exited with code ${code}: ${stderr.trim()}`))
      } else {
        resolve(stdout)
      }
    })
    proc.on('error', reject)
  })
}

export async function runSkillScriptByName(skill: Skill, scriptName: string, env: Record<string, string>): Promise<string> {
  const rel = resolveSkillAsset(skill.scripts, scriptName, 'scripts')
  if (!rel) throw new Error(`Script not found: ${scriptName} in skill ${skill.metadata.name}`)
  return runSkillScript(join(skill.dir, rel), env)
}

import { join } from 'path'
import type { IMessage } from '../providers/types'
import type { Skill } from './types'

export async function runSkillScript(scriptPath: string, env: Record<string, string>): Promise<string> {
  const ext = scriptPath.split('.').pop()?.toLowerCase()
  const cmd = ext === 'ts' || ext === 'js' ? ['bun', 'run', scriptPath] : ['sh', scriptPath]

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

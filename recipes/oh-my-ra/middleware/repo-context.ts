import type { LoopContext } from "@chinmaymk/ra"
import { execSync } from "node:child_process"

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim()
  } catch {
    return ""
  }
}

export default async function repoContext(ctx: LoopContext): Promise<void> {
  const branch = run("git branch --show-current")
  const log = run("git log --oneline -10")
  const status = run("git diff --stat HEAD")
  const remote = run("git remote get-url origin 2>/dev/null")

  if (!branch && !log) return

  const parts = ["## Repository Context"]
  if (branch) parts.push(`**Branch:** ${branch}`)
  if (remote) parts.push(`**Remote:** ${remote}`)
  if (log) parts.push(`**Recent commits:**\n${log}`)
  if (status) parts.push(`**Uncommitted changes:**\n${status}`)

  const pkg = run("cat package.json 2>/dev/null | head -5")
  if (pkg) parts.push(`**package.json (head):**\n${pkg}`)

  ctx.messages.push({
    role: "user",
    content: `<system-reminder>\n${parts.join("\n\n")}\n</system-reminder>`,
  })
}

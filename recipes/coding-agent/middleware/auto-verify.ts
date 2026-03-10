import type { ToolResultContext } from "@chinmaymk/ra"

const VERIFIABLE_TOOLS = new Set(["write_file", "update_file"])

// File extensions that support quick syntax validation
const SYNTAX_CHECK: Record<string, (path: string) => string> = {
  ".ts": (p) => `bun build --no-bundle "${p}" 2>&1 | head -20`,
  ".tsx": (p) => `bun build --no-bundle "${p}" 2>&1 | head -20`,
  ".js": (p) => `node --check "${p}" 2>&1`,
  ".mjs": (p) => `node --check "${p}" 2>&1`,
  ".json": (p) => `node -e "JSON.parse(require('fs').readFileSync('${p}','utf8'))" 2>&1`,
  ".py": (p) => `python3 -c "import ast; ast.parse(open('${p}').read())" 2>&1`,
}

function getExtension(path: string): string {
  const dot = path.lastIndexOf(".")
  return dot >= 0 ? path.slice(dot) : ""
}

function extractPath(toolCall: { name: string; arguments: string }): string | null {
  try {
    const args = JSON.parse(toolCall.arguments || "{}")
    return (args as { path?: string }).path ?? null
  } catch {
    return null
  }
}

export default async function autoVerify(ctx: ToolResultContext): Promise<void> {
  if (!VERIFIABLE_TOOLS.has(ctx.toolCall.name)) return
  if (ctx.result.isError) return

  const filePath = extractPath(ctx.toolCall)
  if (!filePath) return

  const ext = getExtension(filePath)
  const checkFn = SYNTAX_CHECK[ext]
  if (!checkFn) return

  const command = checkFn(filePath)

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    const exitCode = await proc.exited
    const output = (stdout + stderr).trim()

    if (exitCode !== 0 && output) {
      // Append syntax error info to the tool result so the model sees it immediately
      ctx.result.content += `\n\n⚠ Syntax check failed:\n${output}`
    }
  } catch {
    // Don't block on verification failures — the model will catch issues via tests
  }
}

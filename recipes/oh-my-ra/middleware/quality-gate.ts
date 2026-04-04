import type { ToolExecutionContext } from "@chinmaymk/ra"

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf?\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-f/,
  /\bgit\s+checkout\s+--\s/,
  /\bgit\s+branch\s+-D\b/,
  /\bdrop\s+table\b/i,
  /\bdrop\s+database\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b.*\bwhere\b.*\b1\s*=\s*1\b/i,
]

const SECRET_PATTERNS = [
  /\.env$/,
  /\.env\.\w+$/,
  /credentials\.json$/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
]

function getToolInput(toolCall: { name: string; input: unknown }): {
  command?: string
  file_path?: string
  content?: string
} {
  return (toolCall.input ?? {}) as {
    command?: string
    file_path?: string
    content?: string
  }
}

export default async function qualityGate(
  ctx: ToolExecutionContext
): Promise<void> {
  const { toolCall } = ctx
  const input = getToolInput(toolCall)

  if (toolCall.name === "Bash" && input.command) {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(input.command)) {
        ctx.deny(
          `Blocked destructive command: "${input.command}" matches safety pattern ${pattern}. Ask the user for explicit approval first.`
        )
        return
      }
    }
  }

  if (
    (toolCall.name === "Write" || toolCall.name === "Edit") &&
    input.file_path
  ) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(input.file_path)) {
        ctx.deny(
          `Blocked write to sensitive file: "${input.file_path}". Secret files should not be modified by the agent.`
        )
        return
      }
    }
  }

  if (toolCall.name === "Write" && input.content) {
    const secretLeaks = [
      /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}/i,
      /AKIA[0-9A-Z]{16}/,
      /sk-[a-zA-Z0-9]{20,}/,
      /ghp_[a-zA-Z0-9]{36}/,
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    ]
    for (const pattern of secretLeaks) {
      if (pattern.test(input.content)) {
        ctx.deny(
          "Blocked write containing potential secret or credential. Review the content before writing."
        )
        return
      }
    }
  }
}

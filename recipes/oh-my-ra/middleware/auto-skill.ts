import type { LoopContext } from "@chinmaymk/ra"

interface SkillPattern {
  skill: string
  patterns: RegExp[]
  description: string
}

const SKILL_PATTERNS: SkillPattern[] = [
  {
    skill: "/deep-research",
    patterns: [
      /\bresearch\b.*\b(how|what|why|where)\b/i,
      /\bexplore\b.*\b(codebase|code|project|system)\b/i,
      /\bhow does\b.*\bwork\b/i,
      /\bunderstand\b.*\b(architecture|system|flow|design)\b/i,
    ],
    description: "deep research for broad exploration",
  },
  {
    skill: "/interview",
    patterns: [
      /\b(build|create|implement|add|make)\b.*\b(something|a thing|feature)\b/i,
      /\b(want|need)\b.*\bbut\b.*\b(not sure|unsure|don't know)\b/i,
    ],
    description: "clarifying questions before starting",
  },
  {
    skill: "/debugger",
    patterns: [
      /\b(bug|broken|failing|crash|error|exception|doesn't work|not working)\b/i,
      /\btest.*fail/i,
      /\bfix\b.*\b(issue|problem|error)\b/i,
    ],
    description: "systematic debugging",
  },
  {
    skill: "/security-audit",
    patterns: [
      /\b(security|audit|vulnerability|vulnerabilities|CVE|OWASP)\b/i,
      /\b(pentest|penetration|exploit|injection|XSS|CSRF|SSRF)\b/i,
    ],
    description: "security-focused code review",
  },
  {
    skill: "/architect",
    patterns: [
      /\b(design|architect|architecture|system design)\b/i,
      /\b(how should|best way to|approach for)\b.*\b(structure|organize|build)\b/i,
      /\btrade-?offs?\b/i,
    ],
    description: "system design and trade-off analysis",
  },
  {
    skill: "/refactor",
    patterns: [
      /\b(refactor|restructure|reorganize|clean up|rewrite)\b/i,
      /\b(extract|split|move|rename)\b.*\b(module|file|function|class|component)\b/i,
    ],
    description: "safe incremental refactoring",
  },
  {
    skill: "/ultrawork",
    patterns: [
      /\bultrawork\b/i,
      /\bjust do it\b/i,
      /\bgo all out\b/i,
      /\bfull auto\b/i,
    ],
    description: "full autonomous pipeline",
  },
  {
    skill: "/team",
    patterns: [
      /\b(team|parallel|simultaneously|concurrent)\b.*\b(work|review|check|analyze)\b/i,
      /\bmultiple.*\b(perspectives|angles|specialists)\b/i,
    ],
    description: "parallel specialist coordination",
  },
]

export default async function autoSkill(ctx: LoopContext): Promise<void> {
  if (ctx.iteration > 1) return

  const lastMessage = ctx.messages[ctx.messages.length - 1]
  if (!lastMessage || lastMessage.role !== "user") return

  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : Array.isArray(lastMessage.content)
        ? lastMessage.content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text?: string }) => b.text ?? "")
            .join(" ")
        : ""

  if (!content) return

  // Don't suggest if the user already invoked a skill
  if (/^\/\w+/.test(content.trim())) return

  const matches: { skill: string; description: string }[] = []
  for (const sp of SKILL_PATTERNS) {
    if (sp.patterns.some((p) => p.test(content))) {
      matches.push({ skill: sp.skill, description: sp.description })
    }
  }

  if (matches.length === 0) return

  const suggestions = matches
    .slice(0, 2)
    .map((m) => `- \`${m.skill}\` — ${m.description}`)
    .join("\n")

  ctx.messages.push({
    role: "user",
    content: `<system-reminder>\n## Skill Suggestions\n\nBased on this request, consider activating:\n${suggestions}\n\nOnly suggest these to the user if you think they'd benefit. Don't force it.\n</system-reminder>`,
  })
}

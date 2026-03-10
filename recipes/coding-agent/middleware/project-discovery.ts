import type { LoopContext } from "@chinmaymk/ra"
import { join } from "path"

interface ProjectInfo {
  type: string
  root: string
  packageManager?: string
  testCommand?: string
  buildCommand?: string
  lintCommand?: string
  typeCheckCommand?: string
  conventions?: string
}

const CONFIG_FILES: Record<string, string> = {
  "package.json": "node",
  "Cargo.toml": "rust",
  "pyproject.toml": "python",
  "setup.py": "python",
  "go.mod": "go",
  "pom.xml": "java",
  "build.gradle": "java",
  "Gemfile": "ruby",
  "mix.exs": "elixir",
  "composer.json": "php",
}

const CONVENTION_FILES = [
  "CLAUDE.md",
  ".cursorrules",
  "AGENTS.md",
  "CONVENTIONS.md",
  "CONTRIBUTING.md",
  ".github/CONTRIBUTING.md",
]

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path)
    if (await file.exists()) return await file.text()
  } catch { /* ignore */ }
  return null
}

async function detectProjectType(cwd: string): Promise<ProjectInfo> {
  const info: ProjectInfo = { type: "unknown", root: cwd }

  for (const [file, type] of Object.entries(CONFIG_FILES)) {
    if (await fileExists(join(cwd, file))) {
      info.type = type
      break
    }
  }

  if (info.type === "node") {
    const pkg = await readFileIfExists(join(cwd, "package.json"))
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg) as { scripts?: Record<string, string> }
        const scripts = parsed.scripts ?? {}

        if (scripts.test) info.testCommand = resolveRunner(cwd, scripts.test)
        if (scripts.build) info.buildCommand = resolveRunner(cwd, scripts.build)
        if (scripts.lint) info.lintCommand = resolveRunner(cwd, scripts.lint)
        if (scripts.typecheck || scripts["type-check"]) {
          info.typeCheckCommand = resolveRunner(cwd, scripts.typecheck || scripts["type-check"]!)
        } else if (scripts.build?.includes("tsc") || await fileExists(join(cwd, "tsconfig.json"))) {
          // Infer tsc if tsconfig exists
          info.typeCheckCommand = resolveRunner(cwd, "tsc --noEmit")
        }
      } catch { /* malformed package.json */ }
    }

    // Detect package manager
    if (await fileExists(join(cwd, "bun.lockb")) || await fileExists(join(cwd, "bun.lock"))) {
      info.packageManager = "bun"
    } else if (await fileExists(join(cwd, "pnpm-lock.yaml"))) {
      info.packageManager = "pnpm"
    } else if (await fileExists(join(cwd, "yarn.lock"))) {
      info.packageManager = "yarn"
    } else {
      info.packageManager = "npm"
    }
  } else if (info.type === "rust") {
    info.testCommand = "cargo test"
    info.buildCommand = "cargo build"
    info.typeCheckCommand = "cargo check"
    info.lintCommand = "cargo clippy"
  } else if (info.type === "python") {
    info.testCommand = "pytest"
    info.typeCheckCommand = "mypy ."
    info.lintCommand = "ruff check ."
  } else if (info.type === "go") {
    info.testCommand = "go test ./..."
    info.buildCommand = "go build ./..."
    info.lintCommand = "golangci-lint run"
  }

  // Look for convention files
  for (const convFile of CONVENTION_FILES) {
    const content = await readFileIfExists(join(cwd, convFile))
    if (content) {
      // Take first 2000 chars to avoid bloating context
      info.conventions = content.slice(0, 2000)
      break
    }
  }

  return info
}

function resolveRunner(cwd: string, script: string): string {
  // Don't wrap if it already has a runner prefix
  if (script.startsWith("bun ") || script.startsWith("npx ") || script.startsWith("node ")) {
    return script
  }
  return script
}

function formatProjectContext(info: ProjectInfo): string {
  const lines: string[] = ["<project_context>"]
  lines.push(`  <type>${info.type}</type>`)
  lines.push(`  <root>${info.root}</root>`)
  if (info.packageManager) lines.push(`  <package_manager>${info.packageManager}</package_manager>`)
  if (info.testCommand) lines.push(`  <test_command>${info.testCommand}</test_command>`)
  if (info.buildCommand) lines.push(`  <build_command>${info.buildCommand}</build_command>`)
  if (info.lintCommand) lines.push(`  <lint_command>${info.lintCommand}</lint_command>`)
  if (info.typeCheckCommand) lines.push(`  <typecheck_command>${info.typeCheckCommand}</typecheck_command>`)
  if (info.conventions) {
    lines.push(`  <conventions>`)
    lines.push(info.conventions)
    lines.push(`  </conventions>`)
  }
  lines.push("</project_context>")
  return lines.join("\n")
}

export default async function projectDiscovery(ctx: LoopContext): Promise<void> {
  const cwd = process.cwd()
  const info = await detectProjectType(cwd)

  if (info.type === "unknown" && !info.conventions) return

  const contextBlock = formatProjectContext(info)

  // Inject as a system message at the start of the conversation
  const firstMsg = ctx.messages[0]
  if (firstMsg && firstMsg.role === "system" && typeof firstMsg.content === "string") {
    firstMsg.content = `${firstMsg.content}\n\n${contextBlock}`
  } else {
    ctx.messages.unshift({ role: "system", content: contextBlock })
  }
}

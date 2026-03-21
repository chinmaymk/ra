import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"

const CONTEXT_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
]

function getGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim()
  } catch {
    return null
  }
}

function collectContextFiles(from: string, to: string): string[] {
  const found: string[] = []
  let dir = resolve(from)
  const root = resolve(to)

  while (true) {
    for (const name of CONTEXT_FILES) {
      const path = join(dir, name)
      if (existsSync(path)) {
        found.push(path)
      }
    }
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Root first, most specific last (so specific overrides general in context)
  return found.reverse()
}

// --- Main ---

const cwd = process.cwd()
const gitRoot = getGitRoot() || cwd

const contextFiles = collectContextFiles(cwd, gitRoot)

if (contextFiles.length === 0) {
  console.log("## Project Context")
  console.log("")
  console.log("No context files found (CLAUDE.md, AGENTS.md, .cursorrules).")
  console.log("Infer conventions from existing code, package.json scripts, and recent git history.")
} else {
  console.log(`## Project Context (${contextFiles.length} files)`)
  console.log("")
  console.log("Files are ordered general → specific. More specific rules override general ones.")
  console.log("")

  for (const path of contextFiles) {
    const relativePath = path.startsWith(cwd)
      ? path.slice(cwd.length + 1)
      : path.startsWith(gitRoot)
        ? path.slice(gitRoot.length + 1)
        : path
    try {
      const content = readFileSync(path, "utf-8").trim()
      console.log(`### ${relativePath}`)
      console.log("")
      console.log(content)
      console.log("")
    } catch {
      console.log(`### ${relativePath}`)
      console.log("")
      console.log("(could not read file)")
      console.log("")
    }
  }
}

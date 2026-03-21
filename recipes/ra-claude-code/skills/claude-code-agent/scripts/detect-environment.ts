import { execSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"
import { platform } from "node:os"

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim()
  } catch {
    return ""
  }
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

// --- Environment ---

console.log("## Environment")
console.log("")
console.log(`- Platform: ${platform()}`)
console.log(`- Shell: ${process.env.SHELL || process.env.COMSPEC || "unknown"}`)

// Git info
const isGitRepo = exec("git rev-parse --is-inside-work-tree") === "true"
if (isGitRepo) {
  console.log("- Git repository: yes")
  const branch = exec("git branch --show-current") || "detached"
  console.log(`- Branch: ${branch}`)
  const porcelain = exec("git status --porcelain")
  const dirtyCount = porcelain ? porcelain.split("\n").length : 0
  console.log(`- Uncommitted changes: ${dirtyCount} files`)
} else {
  console.log("- Git repository: no")
}

// --- Project ---

console.log("")
console.log("## Project")

if (fileExists("package.json")) {
  const pkg = readJson("package.json")
  if (pkg) {
    console.log(`- Name: ${(pkg.name as string) || "unknown"}`)

    if (fileExists("bun.lockb") || fileExists("bun.lock")) {
      console.log("- Runtime: bun")
    } else if (fileExists("pnpm-lock.yaml")) {
      console.log("- Package manager: pnpm")
    } else if (fileExists("yarn.lock")) {
      console.log("- Package manager: yarn")
    } else if (fileExists("package-lock.json")) {
      console.log("- Package manager: npm")
    }

    const scripts = pkg.scripts as Record<string, string> | undefined
    if (scripts && Object.keys(scripts).length > 0) {
      console.log("- Scripts:")
      for (const [k, v] of Object.entries(scripts).slice(0, 10)) {
        console.log(`  - ${k}: ${v}`)
      }
    }
  }
} else if (fileExists("pyproject.toml")) {
  console.log("- Language: Python")
  console.log("- Config: pyproject.toml")
} else if (fileExists("Cargo.toml")) {
  console.log("- Language: Rust")
  console.log("- Config: Cargo.toml")
} else if (fileExists("go.mod")) {
  console.log("- Language: Go")
  console.log("- Config: go.mod")
}

// --- Config Files ---

console.log("")
console.log("## Config Files")

const configPatterns = [
  "tsconfig.json",
  "biome.json",
  "Makefile",
  "Dockerfile",
]
const configPrefixes = [".eslintrc", ".prettierrc", "docker-compose"]

function scanDir(dir: string, depth: number): string[] {
  if (depth > 2) return []
  const results: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue
      const full = join(dir, entry)
      const name = basename(full)
      try {
        const stat = statSync(full)
        if (stat.isFile()) {
          if (configPatterns.includes(name) || configPrefixes.some((p) => name.startsWith(p))) {
            results.push(full)
          }
        } else if (stat.isDirectory() && depth < 2) {
          results.push(...scanDir(full, depth + 1))
        }
      } catch {
        // skip inaccessible entries
      }
    }
  } catch {
    // skip inaccessible dirs
  }
  return results
}

// Also check .github/workflows
const workflowDir = join(".", ".github", "workflows")
try {
  if (existsSync(workflowDir)) {
    for (const f of readdirSync(workflowDir)) {
      if (f.endsWith(".yml") || f.endsWith(".yaml")) {
        console.log(`- ${join(workflowDir, f)}`)
      }
    }
  }
} catch {
  // skip
}

for (const found of scanDir(".", 0)) {
  console.log(`- ${found}`)
}

import type { ITool } from "@chinmaymk/ra"
import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { execSync } from "node:child_process"

function run(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000, cwd }).trim()
  } catch {
    return ""
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path, "utf-8")
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

async function getDirectoryTree(dir: string, depth: number, maxFiles: number): Promise<string[]> {
  if (depth <= 0) return []
  const entries: string[] = []
  try {
    const items = await readdir(dir, { withFileTypes: true })
    let count = 0
    for (const item of items) {
      if (count >= maxFiles) {
        entries.push(`  ... and ${items.length - count} more`)
        break
      }
      if (item.name.startsWith(".") || item.name === "node_modules" || item.name === "dist" || item.name === "__pycache__") continue
      const fullPath = join(dir, item.name)
      if (item.isDirectory()) {
        entries.push(`${item.name}/`)
        if (depth > 1) {
          const children = await getDirectoryTree(fullPath, depth - 1, 10)
          for (const child of children) entries.push(`  ${child}`)
        }
      } else {
        entries.push(item.name)
      }
      count++
    }
  } catch { /* ignore permission errors */ }
  return entries
}

export default function projectScanTool(): ITool {
  return {
    name: "ProjectScan",
    description:
      "Scans the project to discover its structure, tech stack, conventions, and configuration. " +
      "Use at the start of a session or when entering an unfamiliar codebase. " +
      "Returns a structured overview including: directory tree, package manager, language, " +
      "frameworks, test runner, scripts, git info, and discovered conventions.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Project root directory to scan (default: current directory)",
        },
        depth: {
          type: "number",
          description: "Directory tree depth (default: 2)",
        },
      },
      required: [],
    },
    async execute(input: unknown) {
      const { path: projectPath = ".", depth = 2 } = input as {
        path?: string
        depth?: number
      }
      const root = projectPath

      const sections: string[] = ["# Project Scan"]

      // Directory tree
      const tree = await getDirectoryTree(root, depth, 30)
      if (tree.length > 0) {
        sections.push(`## Directory Structure\n\`\`\`\n${tree.join("\n")}\n\`\`\``)
      }

      // Git info
      const branch = run("git branch --show-current", root)
      const remoteUrl = run("git remote get-url origin 2>/dev/null", root)
      const lastCommit = run("git log --oneline -1", root)
      const uncommitted = run("git status --short", root)
      if (branch) {
        const gitInfo = [`**Branch:** ${branch}`]
        if (remoteUrl) gitInfo.push(`**Remote:** ${remoteUrl}`)
        if (lastCommit) gitInfo.push(`**Last commit:** ${lastCommit}`)
        if (uncommitted) gitInfo.push(`**Uncommitted:**\n\`\`\`\n${uncommitted}\n\`\`\``)
        sections.push(`## Git\n${gitInfo.join("\n")}`)
      }

      // Tech stack detection
      const stack: string[] = []
      const scripts: Record<string, string> = {}
      const detectedConventions: string[] = []

      // Node.js / Bun
      const pkg = await readJson(join(root, "package.json"))
      if (pkg) {
        const name = pkg.name as string | undefined
        if (name) stack.push(`**Package:** ${name}`)

        const deps = {
          ...(pkg.dependencies as Record<string, string> | undefined),
          ...(pkg.devDependencies as Record<string, string> | undefined),
        }

        // Detect frameworks
        const frameworks: string[] = []
        const frameworkMap: Record<string, string> = {
          react: "React", next: "Next.js", vue: "Vue", nuxt: "Nuxt",
          svelte: "Svelte", express: "Express", fastify: "Fastify",
          hono: "Hono", elysia: "Elysia", "@nestjs/core": "NestJS",
          tailwindcss: "Tailwind CSS", prisma: "Prisma",
        }
        for (const [key, label] of Object.entries(frameworkMap)) {
          if (deps[key]) frameworks.push(label)
        }
        if (frameworks.length > 0) stack.push(`**Frameworks:** ${frameworks.join(", ")}`)

        // Detect test runner
        const testRunners: string[] = []
        if (deps.jest || deps["@jest/core"]) testRunners.push("Jest")
        if (deps.vitest) testRunners.push("Vitest")
        if (deps.mocha) testRunners.push("Mocha")
        if (deps["@types/bun"]) testRunners.push("Bun test")
        if (testRunners.length > 0) stack.push(`**Test runner:** ${testRunners.join(", ")}`)

        // Detect linting/formatting
        const linters: string[] = []
        if (deps.eslint) linters.push("ESLint")
        if (deps.biome || deps["@biomejs/biome"]) linters.push("Biome")
        if (deps.prettier) linters.push("Prettier")
        if (linters.length > 0) stack.push(`**Linting:** ${linters.join(", ")}`)

        // Language
        if (deps.typescript || await exists(join(root, "tsconfig.json"))) {
          stack.push("**Language:** TypeScript")
        } else {
          stack.push("**Language:** JavaScript")
        }

        // Package manager
        if (await exists(join(root, "bun.lockb")) || await exists(join(root, "bun.lock"))) {
          stack.push("**Package manager:** Bun")
        } else if (await exists(join(root, "pnpm-lock.yaml"))) {
          stack.push("**Package manager:** pnpm")
        } else if (await exists(join(root, "yarn.lock"))) {
          stack.push("**Package manager:** Yarn")
        } else if (await exists(join(root, "package-lock.json"))) {
          stack.push("**Package manager:** npm")
        }

        // Scripts
        if (pkg.scripts && typeof pkg.scripts === "object") {
          Object.assign(scripts, pkg.scripts as Record<string, string>)
        }
      }

      // Python
      if (await exists(join(root, "pyproject.toml"))) {
        stack.push("**Language:** Python")
        const pyproject = await readFile(join(root, "pyproject.toml"), "utf-8").catch(() => "")
        if (pyproject.includes("pytest")) stack.push("**Test runner:** pytest")
        if (pyproject.includes("ruff")) stack.push("**Linting:** Ruff")
        if (pyproject.includes("uv")) stack.push("**Package manager:** uv")
      } else if (await exists(join(root, "requirements.txt"))) {
        stack.push("**Language:** Python")
        stack.push("**Package manager:** pip")
      }

      // Rust
      if (await exists(join(root, "Cargo.toml"))) {
        stack.push("**Language:** Rust")
        stack.push("**Package manager:** Cargo")
      }

      // Go
      if (await exists(join(root, "go.mod"))) {
        stack.push("**Language:** Go")
        stack.push("**Package manager:** Go modules")
      }

      if (stack.length > 0) {
        sections.push(`## Tech Stack\n${stack.join("\n")}`)
      }

      // Scripts
      if (Object.keys(scripts).length > 0) {
        const scriptLines = Object.entries(scripts)
          .slice(0, 15)
          .map(([k, v]) => `- \`${k}\`: \`${v}\``)
        sections.push(`## Available Scripts\n${scriptLines.join("\n")}`)
      }

      // Conventions
      const conventionFiles = [
        "CLAUDE.md", "AGENTS.md", ".cursorrules", ".editorconfig",
        ".prettierrc", ".prettierrc.json", "biome.json",
        ".eslintrc", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs",
      ]
      for (const file of conventionFiles) {
        if (await exists(join(root, file))) {
          detectedConventions.push(file)
        }
      }
      if (detectedConventions.length > 0) {
        sections.push(`## Convention Files Found\n${detectedConventions.map(f => `- \`${f}\``).join("\n")}`)
      }

      // Workspaces
      if (pkg?.workspaces) {
        const ws = pkg.workspaces as string[]
        sections.push(`## Workspaces\n${ws.map(w => `- \`${w}\``).join("\n")}`)
      }

      return sections.join("\n\n")
    },
  }
}

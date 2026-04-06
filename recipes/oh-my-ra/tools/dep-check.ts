import type { ITool } from "@chinmaymk/ra"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { execSync } from "node:child_process"

function run(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30000, cwd }).trim()
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

export default function dependencyCheckTool(): ITool {
  return {
    name: "DependencyCheck",
    description:
      "Audit project dependencies for known vulnerabilities, outdated packages, and license issues. " +
      "Supports npm/bun/yarn (package.json), pip (requirements.txt), and cargo (Cargo.toml). " +
      "Returns a structured report with severity levels and recommended actions.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Project root directory (default: current directory)",
        },
        check: {
          type: "string",
          description:
            "What to check: 'all', 'vulnerabilities', 'outdated', or 'licenses' (default: all)",
        },
      },
      required: [],
    },
    async execute(input: unknown) {
      const { path: projectPath = ".", check = "all" } = input as {
        path?: string
        check?: string
      }

      const sections: string[] = ["# Dependency Check"]

      // Detect ecosystem
      const hasPkg = await exists(join(projectPath, "package.json"))
      const hasCargo = await exists(join(projectPath, "Cargo.toml"))
      const hasPip =
        (await exists(join(projectPath, "requirements.txt"))) ||
        (await exists(join(projectPath, "pyproject.toml")))

      if (!hasPkg && !hasCargo && !hasPip) {
        return "No recognized package manifest found (package.json, Cargo.toml, requirements.txt, or pyproject.toml)."
      }

      // Node.js / Bun
      if (hasPkg) {
        const pkg = JSON.parse(
          await readFile(join(projectPath, "package.json"), "utf-8")
        ) as {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }

        const deps = Object.keys(pkg.dependencies ?? {})
        const devDeps = Object.keys(pkg.devDependencies ?? {})
        sections.push(
          `## Node.js Dependencies\n- **Production:** ${deps.length}\n- **Dev:** ${devDeps.length}`
        )

        // Vulnerabilities
        if (check === "all" || check === "vulnerabilities") {
          const hasBun = await exists(join(projectPath, "bun.lockb")) || await exists(join(projectPath, "bun.lock"))
          if (hasBun) {
            // Bun doesn't have audit yet, so try npm
            const audit = run("npm audit --json 2>/dev/null", projectPath)
            if (audit) {
              try {
                const parsed = JSON.parse(audit) as {
                  metadata?: { vulnerabilities?: Record<string, number> }
                }
                const vulns = parsed.metadata?.vulnerabilities
                if (vulns) {
                  const total = Object.values(vulns).reduce(
                    (a, b) => a + b,
                    0
                  )
                  if (total > 0) {
                    const breakdown = Object.entries(vulns)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ")
                    sections.push(
                      `### Vulnerabilities\n**${total} found** (${breakdown})\n\nRun \`npm audit\` for details.`
                    )
                  } else {
                    sections.push("### Vulnerabilities\nNo known vulnerabilities found.")
                  }
                }
              } catch {
                sections.push(
                  "### Vulnerabilities\nCould not parse audit results."
                )
              }
            } else {
              sections.push("### Vulnerabilities\nNo audit tool available. Install npm to run `npm audit`.")
            }
          } else {
            const audit = run("npm audit --json 2>/dev/null", projectPath)
            if (audit) {
              try {
                const parsed = JSON.parse(audit) as {
                  metadata?: { vulnerabilities?: Record<string, number> }
                }
                const vulns = parsed.metadata?.vulnerabilities
                if (vulns) {
                  const total = Object.values(vulns).reduce(
                    (a, b) => a + b,
                    0
                  )
                  if (total > 0) {
                    const breakdown = Object.entries(vulns)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ")
                    sections.push(
                      `### Vulnerabilities\n**${total} found** (${breakdown})\n\nRun \`npm audit fix\` to auto-fix.`
                    )
                  } else {
                    sections.push("### Vulnerabilities\nNo known vulnerabilities found.")
                  }
                }
              } catch {
                sections.push(
                  "### Vulnerabilities\nCould not parse audit results."
                )
              }
            }
          }
        }

        // Outdated
        if (check === "all" || check === "outdated") {
          const outdated = run(
            "npm outdated --json 2>/dev/null",
            projectPath
          )
          if (outdated && outdated !== "{}") {
            try {
              const parsed = JSON.parse(outdated) as Record<
                string,
                { current: string; wanted: string; latest: string }
              >
              const entries = Object.entries(parsed)
              if (entries.length > 0) {
                const lines = entries.slice(0, 20).map(
                  ([name, info]) =>
                    `| ${name} | ${info.current} | ${info.wanted} | ${info.latest} |`
                )
                sections.push(
                  `### Outdated Packages (${entries.length})\n| Package | Current | Wanted | Latest |\n|---------|---------|--------|--------|\n${lines.join("\n")}${entries.length > 20 ? `\n\n... and ${entries.length - 20} more` : ""}`
                )
              } else {
                sections.push("### Outdated Packages\nAll packages are up to date.")
              }
            } catch {
              sections.push("### Outdated Packages\nCould not parse outdated results.")
            }
          } else {
            sections.push("### Outdated Packages\nAll packages are up to date.")
          }
        }

        // Licenses
        if (check === "all" || check === "licenses") {
          const licenseCheck = run(
            "npx --yes license-checker --summary --json 2>/dev/null | head -50",
            projectPath
          )
          if (licenseCheck) {
            sections.push(`### License Summary\n\`\`\`\n${licenseCheck.slice(0, 1000)}\n\`\`\``)
          }
        }
      }

      // Python
      if (hasPip) {
        if (check === "all" || check === "vulnerabilities") {
          const pipAudit = run("pip-audit --format json 2>/dev/null", projectPath)
          if (pipAudit) {
            sections.push(`### Python Vulnerabilities\n\`\`\`\n${pipAudit.slice(0, 1500)}\n\`\`\``)
          } else {
            const safetyCheck = run("safety check --json 2>/dev/null", projectPath)
            if (safetyCheck) {
              sections.push(`### Python Vulnerabilities\n\`\`\`\n${safetyCheck.slice(0, 1500)}\n\`\`\``)
            } else {
              sections.push("### Python Vulnerabilities\nInstall `pip-audit` or `safety` to check: `pip install pip-audit`")
            }
          }
        }

        if (check === "all" || check === "outdated") {
          const outdated = run("pip list --outdated --format json 2>/dev/null", projectPath)
          if (outdated) {
            try {
              const parsed = JSON.parse(outdated) as {
                name: string
                version: string
                latest_version: string
              }[]
              if (parsed.length > 0) {
                const lines = parsed.slice(0, 20).map(
                  (p) => `| ${p.name} | ${p.version} | ${p.latest_version} |`
                )
                sections.push(
                  `### Python Outdated (${parsed.length})\n| Package | Current | Latest |\n|---------|---------|--------|\n${lines.join("\n")}`
                )
              }
            } catch { /* ignore */ }
          }
        }
      }

      // Rust
      if (hasCargo) {
        if (check === "all" || check === "vulnerabilities") {
          const cargoAudit = run("cargo audit 2>/dev/null", projectPath)
          if (cargoAudit) {
            sections.push(`### Cargo Audit\n\`\`\`\n${cargoAudit.slice(0, 1500)}\n\`\`\``)
          } else {
            sections.push("### Cargo Audit\nInstall `cargo-audit`: `cargo install cargo-audit`")
          }
        }

        if (check === "all" || check === "outdated") {
          const cargoOutdated = run("cargo outdated 2>/dev/null", projectPath)
          if (cargoOutdated) {
            sections.push(`### Cargo Outdated\n\`\`\`\n${cargoOutdated.slice(0, 1500)}\n\`\`\``)
          }
        }
      }

      return sections.join("\n\n")
    },
  }
}

#!/usr/bin/env bun
/**
 * Snapshot the current docs as a versioned copy.
 *
 * Usage:
 *   bun docs/site/scripts/snapshot-version.ts 0.1.0
 *
 * This copies docs/site/ content (excluding .vitepress/dist, node_modules,
 * and the versioned/ directory itself) into docs/site/versioned/0.1.0/,
 * and adds the version to versions.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { execSync } from "node:child_process"

const version = process.argv[2]
if (!version) {
  console.error("Usage: bun snapshot-version.ts <version>")
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version format: ${version} (expected semver like 0.1.0)`)
  process.exit(1)
}

const siteDir = resolve(import.meta.dir, "..")
const versionsFile = join(siteDir, "versions.json")
const versionedDir = join(siteDir, "versioned", version)

// Read existing versions
const versions: string[] = JSON.parse(readFileSync(versionsFile, "utf-8"))
if (versions.includes(version)) {
  console.error(`Version ${version} already exists in versions.json`)
  process.exit(1)
}

// Create versioned directory
mkdirSync(versionedDir, { recursive: true })

// Copy docs content (markdown files and public assets only)
const excludes = [
  ".vitepress",
  "node_modules",
  "versioned",
  "scripts",
  "package.json",
  "bun.lock",
  "bun.lockb",
  "versions.json",
]

const excludeArgs = excludes.map((e) => `--exclude='${e}'`).join(" ")
execSync(`rsync -a ${excludeArgs} ${siteDir}/ ${versionedDir}/`, {
  stdio: "inherit",
})

// Add version to versions.json (newest first)
versions.unshift(version)
writeFileSync(versionsFile, JSON.stringify(versions, null, 2) + "\n")

console.log(`Snapshot created: versioned/${version}/`)
console.log(`Updated versions.json: [${versions.join(", ")}]`)

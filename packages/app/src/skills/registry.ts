import { join, basename } from 'path'
import { mkdir, cp, rm, writeFile } from 'fs/promises'
import { globalRaDir, firstSegment } from '../utils/paths'
import type { PackageSource } from './types'

// ── Directory defaults ──────────────────────────────────────────────

/** Default directory for installed skills: <dataDir>/skills */
export function defaultSkillInstallDir(dataDir: string): string {
  return join(dataDir, 'skills')
}

/** Default directory for installed recipes (global: ~/.ra/recipes) */
export function defaultRecipeInstallDir(): string {
  return join(globalRaDir(), 'recipes')
}

// ── Source parsing ──────────────────────────────────────────────────

/**
 * Parse a skill source string into a registry type and identifier.
 *
 * Formats:
 *   npm:<package>[@version]     → npm registry
 *   github:<owner>/<repo>       → GitHub tarball
 *   https://...                 → raw URL (tarball or git)
 *   <package>                   → defaults to npm
 */
export function parseSkillSource(source: string): { registry: 'npm' | 'github' | 'url'; identifier: string; version?: string } {
  if (source.startsWith('npm:')) {
    const rest = source.slice(4)
    return splitNpmVersion(rest)
  }
  if (source.startsWith('github:')) {
    return { registry: 'github', identifier: source.slice(7) }
  }
  if (source.startsWith('https://') || source.startsWith('http://')) {
    return { registry: 'url', identifier: source }
  }
  // Bare owner/repo format → GitHub
  if (/^[^@/\s]+\/[^/\s]+$/.test(source)) {
    return { registry: 'github', identifier: source }
  }
  // Default: treat as npm package
  return splitNpmVersion(source)
}

/**
 * Parse a recipe source string. Only GitHub repos and URLs are supported.
 * Accepts: owner/repo, github:owner/repo, or https://... URLs.
 */
export function parseRecipeSource(source: string): { registry: 'github' | 'url'; identifier: string } {
  if (source.startsWith('github:')) {
    return { registry: 'github', identifier: source.slice(7) }
  }
  if (source.startsWith('https://') || source.startsWith('http://')) {
    return { registry: 'url', identifier: source }
  }
  // Bare owner/repo format → GitHub
  if (/^[^/\s]+\/[^/\s]+$/.test(source)) {
    return { registry: 'github', identifier: source }
  }
  throw new Error(`Unsupported recipe source: "${source}". Use owner/repo or a URL.`)
}

function splitNpmVersion(pkg: string): { registry: 'npm'; identifier: string; version?: string } {
  // For scoped packages (@scope/name@version), the last @ after the scope is the version separator
  const scopeEnd = pkg.startsWith('@') ? pkg.indexOf('/') : -1
  const atIdx = pkg.lastIndexOf('@')
  if (atIdx > scopeEnd && atIdx > 0) {
    return { registry: 'npm', identifier: pkg.slice(0, atIdx), version: pkg.slice(atIdx + 1) }
  }
  return { registry: 'npm', identifier: pkg }
}

// ── Shared helpers ──────────────────────────────────────────────────

const CONFIG_GLOB = 'ra.config.{yaml,yml,json,toml}'

/** Download a URL to a temp dir, extract it, and run a callback with the extracted path. Cleans up on completion. */
async function withTempExtract<T>(
  installDir: string,
  url: string,
  errorPrefix: string,
  fn: (extractedDir: string) => Promise<T>,
): Promise<T> {
  const tmpDir = join(installDir, '.tmp-install-' + Date.now())
  await mkdir(tmpDir, { recursive: true })

  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`${errorPrefix}: download failed (${resp.status})`)

    const tarballPath = join(tmpDir, 'archive.tgz')
    await Bun.write(tarballPath, resp)

    const extract = Bun.spawnSync(['tar', 'xzf', tarballPath, '-C', tmpDir])
    if (extract.exitCode !== 0) throw new Error(`${errorPrefix}: failed to extract tarball`)

    return await fn(tmpDir)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

/** Find the single extracted directory in a temp dir (GitHub/tarball convention). */
async function findExtractedRoot(tmpDir: string): Promise<string> {
  const entries: string[] = []
  for await (const entry of new Bun.Glob('*/').scan({ cwd: tmpDir, onlyFiles: false })) {
    if (!entry.startsWith('.') && entry !== 'archive.tgz') entries.push(entry.replace(/\/$/, ''))
  }
  return entries.length === 1 ? join(tmpDir, entries[0]!) : tmpDir
}

// ── Skill helpers ───────────────────────────────────────────────────

/** Find all directories containing a SKILL.md within a root directory (one level deep + skills/ convention). */
async function findSkillDirsIn(root: string): Promise<string[]> {
  const dirs = new Set<string>()
  try {
    for await (const rel of new Bun.Glob('{,skills/}*/SKILL.md').scan({ cwd: root, onlyFiles: true })) {
      // rel uses forward slashes from Bun.Glob — split on both separators for safety
      const parts = rel.split(/[/\\]/)
      // For "skills/foo/SKILL.md" → join(root, "skills", "foo"), for "foo/SKILL.md" → join(root, "foo")
      dirs.add(join(root, ...parts.slice(0, -1)))
    }
  } catch { /* not a directory */ }
  return [...dirs]
}

/** Copy skill directories into installDir and write .source.json metadata. Returns installed skill names. */
async function installSkillDirs(
  extractedRoot: string,
  installDir: string,
  source: Omit<PackageSource, 'installedAt'>,
  rootFallbackName?: string,
): Promise<string[]> {
  const installed: string[] = []
  const skillDirs = await findSkillDirsIn(extractedRoot)

  for (const skillDir of skillDirs) {
    const skillName = basename(skillDir)
    const targetDir = join(installDir, skillName)
    await cp(skillDir, targetDir, { recursive: true })
    await writeFile(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
    installed.push(skillName)
  }

  // Root-as-skill fallback: if no subdirectory skills found, check if root itself is a skill
  if (installed.length === 0 && rootFallbackName) {
    const rootSkill = Bun.file(join(extractedRoot, 'SKILL.md'))
    if (await rootSkill.exists()) {
      const targetDir = join(installDir, rootFallbackName)
      await cp(extractedRoot, targetDir, { recursive: true })
      await writeFile(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
      installed.push(rootFallbackName)
    }
  }

  return installed
}

// ── Recipe helpers ──────────────────────────────────────────────────

/** Find all directories containing ra.config.{yaml,yml,json,toml} (one level deep + recipes/ convention). */
async function findRecipeDirsIn(root: string): Promise<string[]> {
  const dirs = new Set<string>()
  try {
    for await (const rel of new Bun.Glob(`{,recipes/}*/${CONFIG_GLOB}`).scan({ cwd: root, onlyFiles: true })) {
      const parts = rel.split(/[/\\]/)
      dirs.add(join(root, ...parts.slice(0, -1)))
    }
  } catch { /* not a directory */ }
  return [...dirs]
}

/** Copy recipe directories into installDir and write .source.json metadata. Returns installed recipe names. */
async function installRecipeDirs(
  extractedRoot: string,
  installDir: string,
  source: Omit<PackageSource, 'installedAt'>,
): Promise<string[]> {
  const installed: string[] = []
  const recipeDirs = await findRecipeDirsIn(extractedRoot)

  for (const recipeDir of recipeDirs) {
    const recipeName = basename(recipeDir)
    const targetDir = join(installDir, recipeName)
    // Overwrite existing recipe if present
    await rm(targetDir, { recursive: true, force: true })
    await cp(recipeDir, targetDir, { recursive: true })
    await writeFile(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
    installed.push(recipeName)
  }

  return installed
}

// ── Skill registry installers ───────────────────────────────────────

async function installSkillFromNpm(packageName: string, version: string | undefined, installDir: string): Promise<string[]> {
  const versionSpec = version ?? 'latest'

  // Fetch package metadata — scoped packages use URL encoding on the full name
  const registryUrl = `https://registry.npmjs.org/${packageName.startsWith('@') ? packageName : encodeURIComponent(packageName)}`
  const metaResp = await fetch(registryUrl)
  if (!metaResp.ok) throw new Error(`npm: package "${packageName}" not found (${metaResp.status})`)
  const meta = await metaResp.json() as Record<string, unknown>

  // Resolve version
  const distTags = meta['dist-tags'] as Record<string, string> | undefined
  const versions = meta['versions'] as Record<string, unknown> | undefined
  let resolvedVersion = versionSpec
  if (distTags?.[versionSpec]) {
    resolvedVersion = distTags[versionSpec]
  }
  if (!versions?.[resolvedVersion]) {
    throw new Error(`npm: version "${resolvedVersion}" not found for "${packageName}"`)
  }
  const versionMeta = versions[resolvedVersion] as Record<string, unknown>
  const dist = versionMeta['dist'] as { tarball: string } | undefined
  if (!dist?.tarball) throw new Error(`npm: no tarball URL for "${packageName}@${resolvedVersion}"`)

  const fallbackName = packageName.replace(/^@[^/]+\//, '').replace(/^ra-skill-/, '')
  const source: Omit<PackageSource, 'installedAt'> = { registry: 'npm', package: packageName, version: resolvedVersion }

  return withTempExtract(installDir, dist.tarball, `npm`, async (tmpDir) => {
    const packageDir = join(tmpDir, 'package')
    const installed = await installSkillDirs(packageDir, installDir, source, fallbackName)
    if (installed.length === 0) throw new Error(`npm: no skills found in "${packageName}@${resolvedVersion}"`)
    return installed
  })
}

async function installSkillFromGithub(repo: string, installDir: string): Promise<string[]> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  const tarballUrl = `https://api.github.com/repos/${owner}/${name}/tarball`
  const source: Omit<PackageSource, 'installedAt'> = { registry: 'github', repo }
  const fallbackName = name.replace(/^ra-skill-/, '')

  return withTempExtract(installDir, tarballUrl, `github`, async (tmpDir) => {
    const repoDir = await findExtractedRoot(tmpDir)
    const installed = await installSkillDirs(repoDir, installDir, source, fallbackName)
    if (installed.length === 0) throw new Error(`github: no skills found in "${repo}"`)
    return installed
  })
}

async function installSkillFromUrl(url: string, installDir: string): Promise<string[]> {
  const source: Omit<PackageSource, 'installedAt'> = { registry: 'url', url }

  return withTempExtract(installDir, url, 'url', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
    const installed = await installSkillDirs(extractedRoot, installDir, source, undefined)
    if (installed.length === 0) throw new Error(`url: no skills found at "${url}"`)
    return installed
  })
}

// ── Recipe registry installers ──────────────────────────────────────

async function installRecipeFromGithub(repo: string, installDir: string): Promise<string[]> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  const tarballUrl = `https://api.github.com/repos/${owner}/${name}/tarball`
  const source: Omit<PackageSource, 'installedAt'> = { registry: 'github', repo }

  return withTempExtract(installDir, tarballUrl, `github`, async (tmpDir) => {
    const repoDir = await findExtractedRoot(tmpDir)
    const installed = await installRecipeDirs(repoDir, installDir, source)
    if (installed.length === 0) throw new Error(`github: no recipes found in "${repo}"`)
    return installed
  })
}

async function installRecipeFromUrl(url: string, installDir: string): Promise<string[]> {
  const source: Omit<PackageSource, 'installedAt'> = { registry: 'url', url }

  return withTempExtract(installDir, url, 'url', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
    const installed = await installRecipeDirs(extractedRoot, installDir, source)
    if (installed.length === 0) throw new Error(`url: no recipes found at "${url}"`)
    return installed
  })
}

// ── Public API: Skills ──────────────────────────────────────────────

/**
 * Install a skill from a source string.
 * Returns the list of installed skill names.
 */
export async function installSkill(source: string, installDir: string): Promise<string[]> {
  await mkdir(installDir, { recursive: true })

  const parsed = parseSkillSource(source)
  switch (parsed.registry) {
    case 'npm':
      return installSkillFromNpm(parsed.identifier, parsed.version, installDir)
    case 'github':
      return installSkillFromGithub(parsed.identifier, installDir)
    case 'url':
      return installSkillFromUrl(parsed.identifier, installDir)
  }
}

/**
 * Remove an installed skill by name.
 */
export async function removeSkill(skillName: string, installDir: string): Promise<void> {
  const skillDir = join(installDir, skillName)
  try {
    await rm(skillDir, { recursive: true })
  } catch {
    throw new Error(`Skill not found: ${skillName} in ${installDir}`)
  }
}

/**
 * List installed skills with their source information.
 */
export async function listInstalledSkills(installDir: string): Promise<Array<{ name: string; source?: PackageSource }>> {
  const dir = installDir
  const skills: Array<{ name: string; source?: PackageSource }> = []

  try {
    for await (const rel of new Bun.Glob('*/SKILL.md').scan({ cwd: dir, onlyFiles: true })) {
      const name = firstSegment(rel)
      let source: PackageSource | undefined
      try {
        const sourceFile = Bun.file(join(dir, name, '.source.json'))
        if (await sourceFile.exists()) {
          source = JSON.parse(await sourceFile.text()) as PackageSource
        }
      } catch { /* no source info */ }
      skills.push({ name, source })
    }
  } catch { /* dir doesn't exist */ }

  return skills
}

// ── Public API: Recipes ─────────────────────────────────────────────

/**
 * Install recipe(s) from a source string.
 * Returns the list of installed recipe names.
 */
export async function installRecipe(source: string, installDir?: string): Promise<string[]> {
  const dir = installDir ?? defaultRecipeInstallDir()
  await mkdir(dir, { recursive: true })

  const parsed = parseRecipeSource(source)
  switch (parsed.registry) {
    case 'github':
      return installRecipeFromGithub(parsed.identifier, dir)
    case 'url':
      return installRecipeFromUrl(parsed.identifier, dir)
  }
}

/**
 * Remove an installed recipe by name.
 */
export async function removeRecipe(recipeName: string, installDir?: string): Promise<void> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const recipeDir = join(dir, recipeName)
  try {
    await rm(recipeDir, { recursive: true })
  } catch {
    throw new Error(`Recipe not found: ${recipeName} in ${dir}`)
  }
}

/**
 * List installed recipes with their source information.
 */
export async function listInstalledRecipes(installDir?: string): Promise<Array<{ name: string; source?: PackageSource }>> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const recipes: Array<{ name: string; source?: PackageSource }> = []

  try {
    for await (const rel of new Bun.Glob(`*/${CONFIG_GLOB}`).scan({ cwd: dir, onlyFiles: true })) {
      const name = firstSegment(rel)
      let source: PackageSource | undefined
      try {
        const sourceFile = Bun.file(join(dir, name, '.source.json'))
        if (await sourceFile.exists()) {
          source = JSON.parse(await sourceFile.text()) as PackageSource
        }
      } catch { /* no source info */ }
      recipes.push({ name, source })
    }
  } catch { /* dir doesn't exist */ }

  return recipes
}

/**
 * Resolve the config file path for an installed recipe by name.
 * Returns the absolute path to the recipe's ra.config.{yaml,yml,json,toml}, or undefined if not found.
 */
export async function resolveRecipeConfigPath(recipeName: string, installDir?: string): Promise<string | undefined> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const recipeDir = join(dir, recipeName)

  try {
    for await (const rel of new Bun.Glob(CONFIG_GLOB).scan({ cwd: recipeDir, onlyFiles: true })) {
      return join(recipeDir, rel)
    }
  } catch { /* dir doesn't exist */ }

  return undefined
}

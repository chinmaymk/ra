import { join, basename } from 'path'
import { mkdirSync, cpSync, rmSync, writeFileSync } from 'fs'
import { homeDir, firstSegment } from '../utils/paths'
import type { SkillSource } from './types'

/** Default directory for installed skills */
export function defaultSkillInstallDir(): string {
  return join(homeDir(), '.ra', 'skills')
}

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
  // Default: treat as npm package
  return splitNpmVersion(source)
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

/** Download a URL to a temp dir, extract it, and run a callback with the extracted path. Cleans up on completion. */
async function withTempExtract<T>(
  installDir: string,
  url: string,
  errorPrefix: string,
  fn: (extractedDir: string) => Promise<T>,
): Promise<T> {
  const tmpDir = join(installDir, '.tmp-install-' + Date.now())
  mkdirSync(tmpDir, { recursive: true })

  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`${errorPrefix}: download failed (${resp.status})`)

    const tarballPath = join(tmpDir, 'archive.tgz')
    await Bun.write(tarballPath, resp)

    const extract = Bun.spawnSync(['tar', 'xzf', tarballPath, '-C', tmpDir])
    if (extract.exitCode !== 0) throw new Error(`${errorPrefix}: failed to extract tarball`)

    return await fn(tmpDir)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

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
  source: Omit<SkillSource, 'installedAt'>,
  rootFallbackName?: string,
): Promise<string[]> {
  const installed: string[] = []
  const skillDirs = await findSkillDirsIn(extractedRoot)

  for (const skillDir of skillDirs) {
    const skillName = basename(skillDir)
    const targetDir = join(installDir, skillName)
    cpSync(skillDir, targetDir, { recursive: true })
    writeFileSync(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
    installed.push(skillName)
  }

  // Root-as-skill fallback: if no subdirectory skills found, check if root itself is a skill
  if (installed.length === 0 && rootFallbackName) {
    const rootSkill = Bun.file(join(extractedRoot, 'SKILL.md'))
    if (await rootSkill.exists()) {
      const targetDir = join(installDir, rootFallbackName)
      cpSync(extractedRoot, targetDir, { recursive: true })
      writeFileSync(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
      installed.push(rootFallbackName)
    }
  }

  return installed
}

// ── Registry installers ─────────────────────────────────────────────

async function installFromNpm(packageName: string, version: string | undefined, installDir: string): Promise<string[]> {
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
  const source: Omit<SkillSource, 'installedAt'> = { registry: 'npm', package: packageName, version: resolvedVersion }

  return withTempExtract(installDir, dist.tarball, `npm`, async (tmpDir) => {
    const packageDir = join(tmpDir, 'package')
    const installed = await installSkillDirs(packageDir, installDir, source, fallbackName)
    if (installed.length === 0) throw new Error(`npm: no skills found in "${packageName}@${resolvedVersion}"`)
    return installed
  })
}

async function installFromGithub(repo: string, installDir: string): Promise<string[]> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  // GitHub API tarball endpoint auto-resolves the default branch
  const tarballUrl = `https://api.github.com/repos/${owner}/${name}/tarball`
  const source: Omit<SkillSource, 'installedAt'> = { registry: 'github', repo }
  const fallbackName = name.replace(/^ra-skill-/, '')

  return withTempExtract(installDir, tarballUrl, `github`, async (tmpDir) => {
    // GitHub extracts to <owner>-<repo>-<sha>/ directory
    const entries: string[] = []
    for await (const entry of new Bun.Glob('*/').scan({ cwd: tmpDir, onlyFiles: false })) {
      if (!entry.startsWith('.') && entry !== 'archive.tgz') entries.push(entry.replace(/\/$/, ''))
    }
    const repoDir = entries.length === 1 ? join(tmpDir, entries[0] as string) : tmpDir

    const installed = await installSkillDirs(repoDir, installDir, source, fallbackName)
    if (installed.length === 0) throw new Error(`github: no skills found in "${repo}"`)
    return installed
  })
}

async function installFromUrl(url: string, installDir: string): Promise<string[]> {
  const source: Omit<SkillSource, 'installedAt'> = { registry: 'url', url }

  return withTempExtract(installDir, url, 'url', async (tmpDir) => {
    // Check for a single extracted directory (common tarball pattern)
    const entries: string[] = []
    for await (const entry of new Bun.Glob('*/').scan({ cwd: tmpDir, onlyFiles: false })) {
      if (!entry.startsWith('.') && entry !== 'archive.tgz') entries.push(entry.replace(/\/$/, ''))
    }
    const extractedRoot = entries.length === 1 ? join(tmpDir, entries[0] as string) : tmpDir

    const installed = await installSkillDirs(extractedRoot, installDir, source, undefined)
    if (installed.length === 0) throw new Error(`url: no skills found at "${url}"`)
    return installed
  })
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Install a skill from a source string.
 * Returns the list of installed skill names.
 */
export async function installSkill(source: string, installDir?: string): Promise<string[]> {
  const dir = installDir ?? defaultSkillInstallDir()
  mkdirSync(dir, { recursive: true })

  const parsed = parseSkillSource(source)
  switch (parsed.registry) {
    case 'npm':
      return installFromNpm(parsed.identifier, parsed.version, dir)
    case 'github':
      return installFromGithub(parsed.identifier, dir)
    case 'url':
      return installFromUrl(parsed.identifier, dir)
  }
}

/**
 * Remove an installed skill by name.
 */
export async function removeSkill(skillName: string, installDir?: string): Promise<void> {
  const dir = installDir ?? defaultSkillInstallDir()
  const skillDir = join(dir, skillName)
  try {
    rmSync(skillDir, { recursive: true })
  } catch {
    throw new Error(`Skill not found: ${skillName} in ${dir}`)
  }
}

/**
 * List installed skills with their source information.
 */
export async function listInstalledSkills(installDir?: string): Promise<Array<{ name: string; source?: SkillSource }>> {
  const dir = installDir ?? defaultSkillInstallDir()
  const skills: Array<{ name: string; source?: SkillSource }> = []

  try {
    for await (const rel of new Bun.Glob('*/SKILL.md').scan({ cwd: dir, onlyFiles: true })) {
      const name = firstSegment(rel)
      let source: SkillSource | undefined
      try {
        const sourceFile = Bun.file(join(dir, name, '.source.json'))
        if (await sourceFile.exists()) {
          source = JSON.parse(await sourceFile.text()) as SkillSource
        }
      } catch { /* no source info */ }
      skills.push({ name, source })
    }
  } catch { /* dir doesn't exist */ }

  return skills
}

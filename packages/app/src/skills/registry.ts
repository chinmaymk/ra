import { join, basename } from 'path'
import { mkdirSync, cpSync, rmSync, writeFileSync } from 'fs'
import { homeDir, firstSegment } from '../utils/paths'
import { parseSource, withTempExtract, findExtractedRoot, resolveNpmTarball } from '../registry/helpers'
import type { SkillSource } from './types'

/** Default directory for installed skills */
export function defaultSkillInstallDir(): string {
  return join(homeDir(), '.ra', 'skills')
}

/**
 * Parse a skill source string into a registry type and identifier.
 * Skills default to npm for bare names (unlike recipes which default to github).
 */
export function parseSkillSource(source: string) {
  return parseSource(source)
}

// ── Skill-specific helpers ──────────────────────────────────────────

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
  const { tarballUrl, resolvedVersion } = await resolveNpmTarball(packageName, version)
  const fallbackName = packageName.replace(/^@[^/]+\//, '').replace(/^ra-skill-/, '')
  const source: Omit<SkillSource, 'installedAt'> = { registry: 'npm', package: packageName, version: resolvedVersion }

  return withTempExtract(installDir, tarballUrl, `npm`, async (tmpDir) => {
    const packageDir = join(tmpDir, 'package')
    const installed = await installSkillDirs(packageDir, installDir, source, fallbackName)
    if (installed.length === 0) throw new Error(`npm: no skills found in "${packageName}@${resolvedVersion}"`)
    return installed
  })
}

async function installFromGithub(repo: string, installDir: string): Promise<string[]> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  const tarballUrl = `https://api.github.com/repos/${owner}/${name}/tarball`
  const source: Omit<SkillSource, 'installedAt'> = { registry: 'github', repo }
  const fallbackName = name.replace(/^ra-skill-/, '')

  return withTempExtract(installDir, tarballUrl, `github`, async (tmpDir) => {
    const repoDir = await findExtractedRoot(tmpDir)
    const installed = await installSkillDirs(repoDir, installDir, source, fallbackName)
    if (installed.length === 0) throw new Error(`github: no skills found in "${repo}"`)
    return installed
  })
}

async function installFromUrl(url: string, installDir: string): Promise<string[]> {
  const source: Omit<SkillSource, 'installedAt'> = { registry: 'url', url }

  return withTempExtract(installDir, url, 'url', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
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

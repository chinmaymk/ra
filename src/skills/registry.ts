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
 */
export function parseSkillSource(source: string): { registry: 'npm' | 'github' | 'url'; identifier: string; version?: string } {
  if (source.startsWith('npm:')) return splitNpmVersion(source.slice(4))
  if (source.startsWith('github:')) return { registry: 'github', identifier: source.slice(7) }
  if (source.startsWith('https://') || source.startsWith('http://')) return { registry: 'url', identifier: source }
  return splitNpmVersion(source)
}

function splitNpmVersion(pkg: string): { registry: 'npm'; identifier: string; version?: string } {
  const scopeEnd = pkg.startsWith('@') ? pkg.indexOf('/') : -1
  const atIdx = pkg.lastIndexOf('@')
  if (atIdx > scopeEnd && atIdx > 0) {
    return { registry: 'npm', identifier: pkg.slice(0, atIdx), version: pkg.slice(atIdx + 1) }
  }
  return { registry: 'npm', identifier: pkg }
}

// ── Shared helpers ──────────────────────────────────────────────────

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

async function findSkillDirsIn(root: string): Promise<string[]> {
  const dirs = new Set<string>()
  try {
    for await (const rel of new Bun.Glob('{,skills/}*/SKILL.md').scan({ cwd: root, onlyFiles: true })) {
      const parts = rel.split(/[/\\]/)
      dirs.add(join(root, ...parts.slice(0, -1)))
    }
  } catch { /* not a directory */ }
  return [...dirs]
}

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

/** Find the single extracted directory inside a tarball extraction (common pattern) */
async function findExtractedRoot(tmpDir: string): Promise<string> {
  const entries: string[] = []
  for await (const entry of new Bun.Glob('*/').scan({ cwd: tmpDir, onlyFiles: false })) {
    if (!entry.startsWith('.') && entry !== 'archive.tgz') entries.push(entry.replace(/\/$/, ''))
  }
  return entries.length === 1 ? join(tmpDir, entries[0]!) : tmpDir
}

// ── Registry installers ─────────────────────────────────────────────

async function installFromNpm(packageName: string, version: string | undefined, installDir: string): Promise<string[]> {
  const versionSpec = version ?? 'latest'

  const registryUrl = `https://registry.npmjs.org/${packageName.startsWith('@') ? packageName : encodeURIComponent(packageName)}`
  const metaResp = await fetch(registryUrl)
  if (!metaResp.ok) throw new Error(`npm: package "${packageName}" not found (${metaResp.status})`)
  const meta = await metaResp.json() as Record<string, unknown>

  const distTags = meta['dist-tags'] as Record<string, string> | undefined
  const versions = meta['versions'] as Record<string, unknown> | undefined
  let resolvedVersion = versionSpec
  if (distTags?.[versionSpec]) resolvedVersion = distTags[versionSpec]
  if (!versions?.[resolvedVersion]) throw new Error(`npm: version "${resolvedVersion}" not found for "${packageName}"`)
  const versionMeta = versions[resolvedVersion] as Record<string, unknown>
  const dist = versionMeta['dist'] as { tarball: string } | undefined
  if (!dist?.tarball) throw new Error(`npm: no tarball URL for "${packageName}@${resolvedVersion}"`)

  const fallbackName = packageName.replace(/^@[^/]+\//, '').replace(/^ra-skill-/, '')
  const source: Omit<SkillSource, 'installedAt'> = { registry: 'npm', package: packageName, version: resolvedVersion }

  return withTempExtract(installDir, dist.tarball, `npm`, async (tmpDir) => {
    const installed = await installSkillDirs(join(tmpDir, 'package'), installDir, source, fallbackName)
    if (installed.length === 0) throw new Error(`npm: no skills found in "${packageName}@${resolvedVersion}"`)
    return installed
  })
}

async function installFromGithub(repo: string, installDir: string): Promise<string[]> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  const source: Omit<SkillSource, 'installedAt'> = { registry: 'github', repo }
  const fallbackName = name.replace(/^ra-skill-/, '')

  return withTempExtract(installDir, `https://api.github.com/repos/${owner}/${name}/tarball`, `github`, async (tmpDir) => {
    const installed = await installSkillDirs(await findExtractedRoot(tmpDir), installDir, source, fallbackName)
    if (installed.length === 0) throw new Error(`github: no skills found in "${repo}"`)
    return installed
  })
}

async function installFromUrl(url: string, installDir: string): Promise<string[]> {
  const source: Omit<SkillSource, 'installedAt'> = { registry: 'url', url }

  return withTempExtract(installDir, url, 'url', async (tmpDir) => {
    const installed = await installSkillDirs(await findExtractedRoot(tmpDir), installDir, source, undefined)
    if (installed.length === 0) throw new Error(`url: no skills found at "${url}"`)
    return installed
  })
}

// ── Public API ──────────────────────────────────────────────────────

export async function installSkill(source: string, installDir?: string): Promise<string[]> {
  const dir = installDir ?? defaultSkillInstallDir()
  mkdirSync(dir, { recursive: true })

  const parsed = parseSkillSource(source)
  switch (parsed.registry) {
    case 'npm': return installFromNpm(parsed.identifier, parsed.version, dir)
    case 'github': return installFromGithub(parsed.identifier, dir)
    case 'url': return installFromUrl(parsed.identifier, dir)
  }
}

export async function removeSkill(skillName: string, installDir?: string): Promise<void> {
  const dir = installDir ?? defaultSkillInstallDir()
  try { rmSync(join(dir, skillName), { recursive: true }) }
  catch { throw new Error(`Skill not found: ${skillName} in ${dir}`) }
}

export async function listInstalledSkills(installDir?: string): Promise<Array<{ name: string; source?: SkillSource }>> {
  const dir = installDir ?? defaultSkillInstallDir()
  const skills: Array<{ name: string; source?: SkillSource }> = []

  try {
    for await (const rel of new Bun.Glob('*/SKILL.md').scan({ cwd: dir, onlyFiles: true })) {
      const name = firstSegment(rel)
      let source: SkillSource | undefined
      try {
        const sourceFile = Bun.file(join(dir, name, '.source.json'))
        if (await sourceFile.exists()) source = JSON.parse(await sourceFile.text()) as SkillSource
      } catch { /* no source info */ }
      skills.push({ name, source })
    }
  } catch { /* dir doesn't exist */ }

  return skills
}

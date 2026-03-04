import { join } from 'path'
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import type { SkillSource } from './types'

/** Default directory for installed skills */
export function defaultSkillInstallDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '~'
  return join(home, '.ra', 'skills')
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
    const atIdx = rest.lastIndexOf('@')
    if (atIdx > 0) {
      return { registry: 'npm', identifier: rest.slice(0, atIdx), version: rest.slice(atIdx + 1) }
    }
    return { registry: 'npm', identifier: rest }
  }
  if (source.startsWith('github:')) {
    return { registry: 'github', identifier: source.slice(7) }
  }
  if (source.startsWith('https://') || source.startsWith('http://')) {
    return { registry: 'url', identifier: source }
  }
  // Default: treat as npm package
  const atIdx = source.lastIndexOf('@')
  if (atIdx > 0) {
    return { registry: 'npm', identifier: source.slice(0, atIdx), version: source.slice(atIdx + 1) }
  }
  return { registry: 'npm', identifier: source }
}

/**
 * Install a skill from npm.
 * Downloads the package tarball to a temp dir, extracts skills, and copies to installDir.
 */
async function installFromNpm(packageName: string, version: string | undefined, installDir: string): Promise<string[]> {
  const versionSpec = version ?? 'latest'
  const tmpDir = join(installDir, '.tmp-install-' + Date.now())
  mkdirSync(tmpDir, { recursive: true })

  try {
    // Use bun/npm to download the package info
    const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`
    const metaResp = await fetch(registryUrl)
    if (!metaResp.ok) throw new Error(`npm: package "${packageName}" not found (${metaResp.status})`)
    const meta = await metaResp.json() as Record<string, unknown>

    // Resolve version
    const distTags = meta['dist-tags'] as Record<string, string> | undefined
    const versions = meta['versions'] as Record<string, unknown> | undefined
    let resolvedVersion = versionSpec
    if (distTags && distTags[versionSpec]) {
      resolvedVersion = distTags[versionSpec]
    }
    if (!versions?.[resolvedVersion]) {
      throw new Error(`npm: version "${resolvedVersion}" not found for "${packageName}"`)
    }
    const versionMeta = versions[resolvedVersion] as Record<string, unknown>
    const dist = versionMeta['dist'] as { tarball: string } | undefined
    if (!dist?.tarball) throw new Error(`npm: no tarball URL for "${packageName}@${resolvedVersion}"`)

    // Download and extract tarball
    const tarballResp = await fetch(dist.tarball)
    if (!tarballResp.ok) throw new Error(`npm: failed to download tarball (${tarballResp.status})`)
    const tarballPath = join(tmpDir, 'package.tgz')
    await Bun.write(tarballPath, tarballResp)

    // Extract with tar
    const extract = Bun.spawnSync(['tar', 'xzf', tarballPath, '-C', tmpDir])
    if (extract.exitCode !== 0) throw new Error('Failed to extract tarball')

    // Look for skills in the extracted package
    // Convention: skills are in the package root or in a "skills/" subdirectory
    // Each directory with a SKILL.md is a skill
    const installed: string[] = []
    const packageDir = join(tmpDir, 'package')
    const skillDirs = await findSkillDirsIn(packageDir)

    for (const skillDir of skillDirs) {
      const skillName = skillDir.split('/').pop()!
      const targetDir = join(installDir, skillName)

      // Copy skill directory
      await copyDir(skillDir, targetDir)

      // Write source metadata
      const source: SkillSource = {
        registry: 'npm',
        package: packageName,
        version: resolvedVersion,
        installedAt: new Date().toISOString(),
      }
      writeFileSync(join(targetDir, '.source.json'), JSON.stringify(source, null, 2))
      installed.push(skillName)
    }

    // If no skill subdirectories found, check if the package root itself is a skill
    if (installed.length === 0 && existsSync(join(packageDir, 'SKILL.md'))) {
      const skillName = packageName.replace(/^@[^/]+\//, '').replace(/^ra-skill-/, '')
      const targetDir = join(installDir, skillName)
      await copyDir(packageDir, targetDir)

      const source: SkillSource = {
        registry: 'npm',
        package: packageName,
        version: resolvedVersion,
        installedAt: new Date().toISOString(),
      }
      writeFileSync(join(targetDir, '.source.json'), JSON.stringify(source, null, 2))
      installed.push(skillName)
    }

    if (installed.length === 0) {
      throw new Error(`npm: no skills found in "${packageName}@${resolvedVersion}"`)
    }

    return installed
  } finally {
    // Clean up temp directory
    try {
      const rm = Bun.spawnSync(['rm', '-rf', tmpDir])
      if (rm.exitCode !== 0) { /* best effort */ }
    } catch { /* ignore */ }
  }
}

/**
 * Install a skill from a GitHub repository.
 * Downloads the default branch tarball, extracts, and copies skills.
 */
async function installFromGithub(repo: string, installDir: string): Promise<string[]> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  const tmpDir = join(installDir, '.tmp-install-' + Date.now())
  mkdirSync(tmpDir, { recursive: true })

  try {
    // Download tarball of default branch
    const tarballUrl = `https://github.com/${owner}/${name}/archive/refs/heads/main.tar.gz`
    let resp = await fetch(tarballUrl)
    if (!resp.ok) {
      // Try master branch
      const masterUrl = `https://github.com/${owner}/${name}/archive/refs/heads/master.tar.gz`
      resp = await fetch(masterUrl)
      if (!resp.ok) throw new Error(`github: failed to download "${repo}" (tried main and master branches)`)
    }

    const tarballPath = join(tmpDir, 'repo.tgz')
    await Bun.write(tarballPath, resp)

    const extract = Bun.spawnSync(['tar', 'xzf', tarballPath, '-C', tmpDir])
    if (extract.exitCode !== 0) throw new Error('Failed to extract GitHub tarball')

    // Find the extracted directory (github names it <repo>-<branch>)
    const entries: string[] = []
    for await (const entry of new Bun.Glob('*').scan({ cwd: tmpDir, onlyFiles: false })) {
      if (entry !== 'repo.tgz') entries.push(entry)
    }
    const repoDir = entries.length === 1 ? join(tmpDir, entries[0]!) : tmpDir

    // Find and install skills
    const installed: string[] = []
    const skillDirs = await findSkillDirsIn(repoDir)

    for (const skillDir of skillDirs) {
      const skillName = skillDir.split('/').pop()!
      const targetDir = join(installDir, skillName)
      await copyDir(skillDir, targetDir)

      const source: SkillSource = {
        registry: 'github',
        repo,
        installedAt: new Date().toISOString(),
      }
      writeFileSync(join(targetDir, '.source.json'), JSON.stringify(source, null, 2))
      installed.push(skillName)
    }

    // Check if repo root is a skill
    if (installed.length === 0 && existsSync(join(repoDir, 'SKILL.md'))) {
      const skillName = name.replace(/^ra-skill-/, '')
      const targetDir = join(installDir, skillName)
      await copyDir(repoDir, targetDir)

      const source: SkillSource = {
        registry: 'github',
        repo,
        installedAt: new Date().toISOString(),
      }
      writeFileSync(join(targetDir, '.source.json'), JSON.stringify(source, null, 2))
      installed.push(skillName)
    }

    if (installed.length === 0) {
      throw new Error(`github: no skills found in "${repo}"`)
    }

    return installed
  } finally {
    try {
      Bun.spawnSync(['rm', '-rf', tmpDir])
    } catch { /* ignore */ }
  }
}

/**
 * Install a skill from a URL (tarball).
 */
async function installFromUrl(url: string, installDir: string): Promise<string[]> {
  const tmpDir = join(installDir, '.tmp-install-' + Date.now())
  mkdirSync(tmpDir, { recursive: true })

  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`url: failed to download "${url}" (${resp.status})`)

    const tarballPath = join(tmpDir, 'download.tgz')
    await Bun.write(tarballPath, resp)

    const extract = Bun.spawnSync(['tar', 'xzf', tarballPath, '-C', tmpDir])
    if (extract.exitCode !== 0) throw new Error('Failed to extract tarball from URL')

    const installed: string[] = []
    const skillDirs = await findSkillDirsIn(tmpDir)

    for (const skillDir of skillDirs) {
      const skillName = skillDir.split('/').pop()!
      const targetDir = join(installDir, skillName)
      await copyDir(skillDir, targetDir)

      const source: SkillSource = {
        registry: 'url',
        url,
        installedAt: new Date().toISOString(),
      }
      writeFileSync(join(targetDir, '.source.json'), JSON.stringify(source, null, 2))
      installed.push(skillName)
    }

    if (installed.length === 0) {
      throw new Error(`url: no skills found at "${url}"`)
    }

    return installed
  } finally {
    try {
      Bun.spawnSync(['rm', '-rf', tmpDir])
    } catch { /* ignore */ }
  }
}

/**
 * Find all directories containing a SKILL.md within a root directory.
 */
async function findSkillDirsIn(root: string): Promise<string[]> {
  const dirs: string[] = []
  try {
    for await (const rel of new Bun.Glob('*/SKILL.md').scan({ cwd: root, onlyFiles: true })) {
      dirs.push(join(root, rel.split('/')[0]!))
    }
    // Also check subdirectory "skills/" convention
    for await (const rel of new Bun.Glob('skills/*/SKILL.md').scan({ cwd: root, onlyFiles: true })) {
      const parts = rel.split('/')
      dirs.push(join(root, parts[0]!, parts[1]!))
    }
  } catch { /* not a directory */ }
  return [...new Set(dirs)]
}

/**
 * Copy a directory recursively.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true })
  const result = Bun.spawnSync(['cp', '-r', src + '/.', dest])
  if (result.exitCode !== 0) {
    // Fallback: try without /. suffix
    const result2 = Bun.spawnSync(['cp', '-rT', src, dest])
    if (result2.exitCode !== 0) {
      throw new Error(`Failed to copy ${src} to ${dest}`)
    }
  }
}

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
  if (!existsSync(skillDir)) {
    throw new Error(`Skill not found: ${skillName} in ${dir}`)
  }
  const result = Bun.spawnSync(['rm', '-rf', skillDir])
  if (result.exitCode !== 0) {
    throw new Error(`Failed to remove skill directory: ${skillDir}`)
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
      const name = rel.split('/')[0]!
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

import { join } from 'path'
import { mkdirSync, cpSync, rmSync, writeFileSync } from 'fs'

export interface SourceInfo {
  registry: 'npm' | 'github' | 'url'
  identifier: string
  version?: string
}

/** Source metadata written to .source.json for installed skills and recipes. */
export interface RegistrySource {
  registry: 'npm' | 'github' | 'url'
  package?: string
  repo?: string
  url?: string
  version?: string
  installedAt: string
}

/** Config file names in priority order (YAML preferred). */
export const CONFIG_FILES = ['ra.config.yaml', 'ra.config.yml', 'ra.config.json', 'ra.config.toml']

/**
 * Parse a source string into a registry type and identifier.
 *
 * Formats:
 *   npm:<package>[@version]     → npm registry
 *   github:<owner>/<repo>       → GitHub tarball
 *   https://...                 → raw URL (tarball or git)
 *   <bare-name>                 → defaults to GitHub
 */
export function parseSource(source: string): SourceInfo {
  if (source.startsWith('npm:')) return splitNpmVersion(source.slice(4))
  if (source.startsWith('github:')) return { registry: 'github', identifier: source.slice(7) }
  if (source.startsWith('https://') || source.startsWith('http://')) return { registry: 'url', identifier: source }
  return { registry: 'github', identifier: source }
}

export function splitNpmVersion(pkg: string): { registry: 'npm'; identifier: string; version?: string } {
  // For scoped packages (@scope/name@version), the last @ after the scope is the version separator
  const scopeEnd = pkg.startsWith('@') ? pkg.indexOf('/') : -1
  const atIdx = pkg.lastIndexOf('@')
  if (atIdx > scopeEnd && atIdx > 0) {
    return { registry: 'npm', identifier: pkg.slice(0, atIdx), version: pkg.slice(atIdx + 1) }
  }
  return { registry: 'npm', identifier: pkg }
}

/** Download a URL to a temp dir, extract it, and run a callback with the extracted path. Cleans up on completion. */
export async function withTempExtract<T>(
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

/** Find the single extracted root directory inside a temp extraction dir (common tarball pattern). */
export async function findExtractedRoot(tmpDir: string): Promise<string> {
  const entries: string[] = []
  for await (const entry of new Bun.Glob('*/').scan({ cwd: tmpDir, onlyFiles: false })) {
    if (!entry.startsWith('.') && entry !== 'archive.tgz') entries.push(entry.replace(/\/$/, ''))
  }
  return entries.length === 1 ? join(tmpDir, entries[0] as string) : tmpDir
}

/** Resolve an npm package to its tarball URL and version. */
export async function resolveNpmTarball(packageName: string, version: string | undefined): Promise<{ tarballUrl: string; resolvedVersion: string }> {
  const versionSpec = version ?? 'latest'

  const registryUrl = `https://registry.npmjs.org/${packageName.startsWith('@') ? packageName : encodeURIComponent(packageName)}`
  const metaResp = await fetch(registryUrl)
  if (!metaResp.ok) throw new Error(`npm: package "${packageName}" not found (${metaResp.status})`)
  const meta = await metaResp.json() as Record<string, unknown>

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

  return { tarballUrl: dist.tarball, resolvedVersion }
}

/** Copy extracted content to target and write .source.json metadata. */
export function copyAndWriteSource(sourceDir: string, targetDir: string, source: Omit<RegistrySource, 'installedAt'>): void {
  mkdirSync(join(targetDir, '..'), { recursive: true })
  cpSync(sourceDir, targetDir, { recursive: true })
  writeFileSync(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
}

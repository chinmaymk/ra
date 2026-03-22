import { join } from 'path'
import { mkdirSync, readdirSync, rmSync } from 'fs'
import { homeDir } from '../utils/paths'
import {
  parseSource, splitNpmVersion, withTempExtract, findExtractedRoot,
  resolveNpmTarball, copyAndWriteSource, CONFIG_FILES,
} from '../registry/helpers'
import type { SourceInfo, RegistrySource } from '../registry/helpers'

export function defaultRecipeInstallDir(): string {
  return join(homeDir(), '.ra', 'recipes')
}

/**
 * Parse a recipe source string. Unlike skills (which default to npm),
 * bare names with a slash default to GitHub.
 */
export function parseRecipeSource(source: string): SourceInfo {
  if (source.includes('/') && !source.includes(':')) {
    return { registry: 'github', identifier: source }
  }
  return parseSource(source)
}

/** Find a ra.config.* file in a directory. Returns the filename or null. */
async function findConfigFile(dir: string): Promise<string | null> {
  for (const name of CONFIG_FILES) {
    if (await Bun.file(join(dir, name)).exists()) return name
  }
  return null
}

/** Resolve an installed recipe name to its config file path. */
export async function resolveRecipePath(name: string, installDir?: string): Promise<string | null> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const configName = await findConfigFile(join(dir, name))
  return configName ? join(dir, name, configName) : null
}

// ── Registry installers ─────────────────────────────────────────────

async function installFromGithub(repo: string, installDir: string): Promise<string> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  const tarballUrl = `https://api.github.com/repos/${owner}/${name}/tarball`

  return withTempExtract(installDir, tarballUrl, 'github', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
    if (!await findConfigFile(extractedRoot)) throw new Error(`github: no ra.config.{yaml,yml,json,toml} found in "${repo}"`)

    copyAndWriteSource(extractedRoot, join(installDir, owner, name), { registry: 'github', repo })
    return `${owner}/${name}`
  })
}

async function installFromNpm(packageName: string, version: string | undefined, installDir: string): Promise<string> {
  const { tarballUrl, resolvedVersion } = await resolveNpmTarball(packageName, version)
  const recipeName = packageName.startsWith('@') ? packageName.slice(1) : packageName

  return withTempExtract(installDir, tarballUrl, 'npm', async (tmpDir) => {
    const packageDir = join(tmpDir, 'package')
    if (!await findConfigFile(packageDir)) throw new Error(`npm: no ra.config.{yaml,yml,json,toml} found in "${packageName}@${resolvedVersion}"`)

    copyAndWriteSource(packageDir, join(installDir, recipeName), { registry: 'npm', package: packageName, version: resolvedVersion })
    return recipeName
  })
}

async function installFromUrl(url: string, installDir: string): Promise<string> {
  return withTempExtract(installDir, url, 'url', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
    if (!await findConfigFile(extractedRoot)) throw new Error(`url: no ra.config.{yaml,yml,json,toml} found at "${url}"`)

    const segments = new URL(url).pathname.split('/').filter(Boolean)
    const recipeName = segments.length >= 2
      ? `${segments[segments.length - 2]}/${segments[segments.length - 1]}`.replace(/\.tar\.gz$|\.tgz$/, '')
      : segments[segments.length - 1]?.replace(/\.tar\.gz$|\.tgz$/, '') ?? 'recipe'

    copyAndWriteSource(extractedRoot, join(installDir, recipeName), { registry: 'url', url })
    return recipeName
  })
}

// ── Public API ──────────────────────────────────────────────────────

export async function installRecipe(source: string, installDir?: string): Promise<string> {
  const dir = installDir ?? defaultRecipeInstallDir()
  mkdirSync(dir, { recursive: true })

  const parsed = parseRecipeSource(source)
  switch (parsed.registry) {
    case 'npm':    return installFromNpm(parsed.identifier, parsed.version, dir)
    case 'github': return installFromGithub(parsed.identifier, dir)
    case 'url':    return installFromUrl(parsed.identifier, dir)
  }
}

export async function removeRecipe(recipeName: string, installDir?: string): Promise<void> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const recipeDir = join(dir, recipeName)
  try {
    rmSync(recipeDir, { recursive: true })
  } catch {
    throw new Error(`Recipe not found: ${recipeName} in ${dir}`)
  }

  // Clean up empty owner directory
  const parts = recipeName.split('/')
  if (parts.length > 1) {
    try { rmSync(join(dir, parts[0] as string)) } catch { /* non-empty or missing, fine */ }
  }
}

export async function listInstalledRecipes(installDir?: string): Promise<Array<{ name: string; source?: RegistrySource }>> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const recipes: Array<{ name: string; source?: RegistrySource }> = []

  try {
    for await (const rel of new Bun.Glob('*/*/ra.config.{yaml,yml,json,toml}').scan({ cwd: dir, onlyFiles: true })) {
      const parts = rel.split(/[/\\]/)
      const name = `${parts[0]}/${parts[1]}`
      if (recipes.some(r => r.name === name)) continue

      let source: RegistrySource | undefined
      try {
        const sourceFile = Bun.file(join(dir, name, '.source.json'))
        if (await sourceFile.exists()) source = JSON.parse(await sourceFile.text()) as RegistrySource
      } catch { /* no source info */ }
      recipes.push({ name, source })
    }
  } catch { /* dir doesn't exist */ }

  return recipes
}

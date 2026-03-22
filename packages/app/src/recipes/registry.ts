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

/** Find recipe directories inside an extracted root (checks recipes/ subdirectory, then root). */
async function findRecipeDirsIn(root: string): Promise<Array<{ name: string; dir: string }>> {
  const results: Array<{ name: string; dir: string }> = []

  // Multi-recipe repo: recipes/<name>/ra.config.*
  const recipesDir = join(root, 'recipes')
  try {
    for await (const rel of new Bun.Glob('*/ra.config.{yaml,yml,json,toml}').scan({ cwd: recipesDir, onlyFiles: true })) {
      const name = rel.split(/[/\\]/)[0] as string
      if (!results.some(r => r.name === name)) {
        results.push({ name, dir: join(recipesDir, name) })
      }
    }
  } catch { /* no recipes/ dir */ }

  // Fallback: root itself has a config file (single-recipe repo)
  if (results.length === 0 && await findConfigFile(root)) {
    results.push({ name: '', dir: root })
  }

  return results
}

async function installFromGithub(repo: string, installDir: string): Promise<string[]> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  const tarballUrl = `https://api.github.com/repos/${owner}/${name}/tarball`

  return withTempExtract(installDir, tarballUrl, 'github', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
    const recipeDirs = await findRecipeDirsIn(extractedRoot)
    if (recipeDirs.length === 0) throw new Error(`github: no recipes found in "${repo}"`)

    const installed: string[] = []
    for (const recipe of recipeDirs) {
      const recipeName = recipe.name ? `${owner}/${recipe.name}` : `${owner}/${name}`
      copyAndWriteSource(recipe.dir, join(installDir, ...recipeName.split('/')), { registry: 'github', repo })
      installed.push(recipeName)
    }
    return installed
  })
}

async function installFromNpm(packageName: string, version: string | undefined, installDir: string): Promise<string[]> {
  const { tarballUrl, resolvedVersion } = await resolveNpmTarball(packageName, version)
  const recipeName = packageName.startsWith('@') ? packageName.slice(1) : packageName

  return withTempExtract(installDir, tarballUrl, 'npm', async (tmpDir) => {
    const packageDir = join(tmpDir, 'package')
    const recipeDirs = await findRecipeDirsIn(packageDir)
    if (recipeDirs.length === 0) throw new Error(`npm: no recipes found in "${packageName}@${resolvedVersion}"`)

    const installed: string[] = []
    for (const recipe of recipeDirs) {
      const name = recipe.name ? `${recipeName}/${recipe.name}` : recipeName
      copyAndWriteSource(recipe.dir, join(installDir, ...name.split('/')), { registry: 'npm', package: packageName, version: resolvedVersion })
      installed.push(name)
    }
    return installed
  })
}

async function installFromUrl(url: string, installDir: string): Promise<string[]> {
  return withTempExtract(installDir, url, 'url', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
    const recipeDirs = await findRecipeDirsIn(extractedRoot)
    if (recipeDirs.length === 0) throw new Error(`url: no recipes found at "${url}"`)

    const segments = new URL(url).pathname.split('/').filter(Boolean)
    const baseName = segments.length >= 2
      ? `${segments[segments.length - 2]}/${segments[segments.length - 1]}`.replace(/\.tar\.gz$|\.tgz$/, '')
      : segments[segments.length - 1]?.replace(/\.tar\.gz$|\.tgz$/, '') ?? 'recipe'

    const installed: string[] = []
    for (const recipe of recipeDirs) {
      const recipeName = recipe.name ? `${baseName}/${recipe.name}` : baseName
      copyAndWriteSource(recipe.dir, join(installDir, ...recipeName.split('/')), { registry: 'url', url })
      installed.push(recipeName)
    }
    return installed
  })
}

// ── Public API ──────────────────────────────────────────────────────

export async function installRecipe(source: string, installDir?: string): Promise<string[]> {
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

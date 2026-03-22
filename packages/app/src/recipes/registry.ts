import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { homeDir } from '../utils/paths'
import {
  parseSource, withTempExtract, findExtractedRoot,
  resolveNpmTarball, copyAndWriteSource, CONFIG_FILES,
} from '../registry/helpers'
import type { RegistrySource } from '../registry/helpers'

export function defaultRecipeInstallDir(): string {
  return join(homeDir(), '.ra', 'recipes')
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

/** Install all recipes found under extractedRoot into installDir. */
async function installRecipeDirs(
  extractedRoot: string,
  installDir: string,
  baseName: string,
  source: Omit<RegistrySource, 'installedAt'>,
  errorContext: string,
): Promise<string[]> {
  const recipeDirs = await findRecipeDirsIn(extractedRoot)
  if (recipeDirs.length === 0) throw new Error(`${errorContext}: no recipes found`)

  return recipeDirs.map(recipe => {
    const name = recipe.name ? `${baseName}/${recipe.name}` : baseName
    copyAndWriteSource(recipe.dir, join(installDir, ...name.split('/')), source)
    return name
  })
}

/** Derive a human-readable base name from a URL path. */
function baseNameFromUrl(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const raw = segments.length >= 2
    ? `${segments[segments.length - 2]}/${segments[segments.length - 1]}`
    : segments[segments.length - 1] ?? 'recipe'
  return raw.replace(/\.tar\.gz$|\.tgz$/, '')
}

// ── Public API ──────────────────────────────────────────────────────

export async function installRecipe(source: string, installDir?: string): Promise<string[]> {
  const dir = installDir ?? defaultRecipeInstallDir()
  mkdirSync(dir, { recursive: true })

  const parsed = parseSource(source)

  switch (parsed.registry) {
    case 'github': {
      const [owner, name] = parsed.identifier.split('/')
      if (!owner || !name) throw new Error(`github: invalid repo "${parsed.identifier}", expected "owner/repo"`)
      const tarballUrl = `https://api.github.com/repos/${owner}/${name}/tarball`
      return withTempExtract(dir, tarballUrl, 'github', async (tmpDir) => {
        const root = await findExtractedRoot(tmpDir)
        return installRecipeDirs(root, dir, `${owner}/${name}`, { registry: 'github', repo: parsed.identifier }, `github: "${parsed.identifier}"`)
      })
    }
    case 'npm': {
      const { tarballUrl, resolvedVersion } = await resolveNpmTarball(parsed.identifier, parsed.version)
      const baseName = parsed.identifier.startsWith('@') ? parsed.identifier.slice(1) : parsed.identifier
      return withTempExtract(dir, tarballUrl, 'npm', async (tmpDir) =>
        installRecipeDirs(join(tmpDir, 'package'), dir, baseName, { registry: 'npm', package: parsed.identifier, version: resolvedVersion }, `npm: "${parsed.identifier}@${resolvedVersion}"`),
      )
    }
    case 'url': {
      return withTempExtract(dir, parsed.identifier, 'url', async (tmpDir) => {
        const root = await findExtractedRoot(tmpDir)
        return installRecipeDirs(root, dir, baseNameFromUrl(parsed.identifier), { registry: 'url', url: parsed.identifier }, `url: "${parsed.identifier}"`)
      })
    }
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

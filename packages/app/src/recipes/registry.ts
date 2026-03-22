import { join } from 'path'
import { mkdirSync, cpSync, rmSync, writeFileSync } from 'fs'
import { homeDir } from '../utils/paths'
import { parseSource, splitNpmVersion, withTempExtract, findExtractedRoot, resolveNpmTarball } from '../registry/helpers'
import type { SourceInfo } from '../registry/helpers'
import type { RecipeSource } from './types'

const CONFIG_NAMES = ['ra.config.yaml', 'ra.config.yml', 'ra.config.json', 'ra.config.toml']

/** Default directory for installed recipes */
export function defaultRecipeInstallDir(): string {
  return join(homeDir(), '.ra', 'recipes')
}

/**
 * Parse a recipe source string. Unlike skills (which default to npm),
 * bare names with a slash default to GitHub.
 */
export function parseRecipeSource(source: string): SourceInfo {
  if (source.startsWith('npm:') || source.startsWith('github:') || source.startsWith('https://') || source.startsWith('http://')) {
    return parseSource(source)
  }
  // Bare name with slash → default to github
  if (source.includes('/')) return { registry: 'github', identifier: source }
  // Bare name without slash → npm
  return splitNpmVersion(source)
}

/** Find a config file in a directory. Returns the filename or null. */
async function findConfigFile(dir: string): Promise<string | null> {
  for (const name of CONFIG_NAMES) {
    if (await Bun.file(join(dir, name)).exists()) return name
  }
  return null
}

/**
 * Resolve an installed recipe name to its config file path.
 * Returns null if not found.
 */
export async function resolveRecipePath(name: string, installDir?: string): Promise<string | null> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const recipeDir = join(dir, name)
  const configName = await findConfigFile(recipeDir)
  return configName ? join(recipeDir, configName) : null
}

// ── Registry installers ─────────────────────────────────────────────

async function installFromGithub(repo: string, installDir: string): Promise<string> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`github: invalid repo format "${repo}", expected "owner/repo"`)

  const tarballUrl = `https://api.github.com/repos/${owner}/${name}/tarball`
  const source: Omit<RecipeSource, 'installedAt'> = { registry: 'github', repo }
  // Recipe name is owner/repo
  const recipeName = `${owner}/${name}`

  return withTempExtract(installDir, tarballUrl, 'github', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
    const configFile = await findConfigFile(extractedRoot)
    if (!configFile) throw new Error(`github: no ra.config.{yaml,yml,json,toml} found in "${repo}"`)

    const targetDir = join(installDir, owner, name)
    mkdirSync(join(installDir, owner), { recursive: true })
    cpSync(extractedRoot, targetDir, { recursive: true })
    writeFileSync(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
    return recipeName
  })
}

async function installFromNpm(packageName: string, version: string | undefined, installDir: string): Promise<string> {
  const { tarballUrl, resolvedVersion } = await resolveNpmTarball(packageName, version)
  const source: Omit<RecipeSource, 'installedAt'> = { registry: 'npm', package: packageName, version: resolvedVersion }

  // Derive recipe name: @scope/name → scope/name, plain → plain
  const recipeName = packageName.startsWith('@') ? packageName.slice(1) : packageName

  return withTempExtract(installDir, tarballUrl, 'npm', async (tmpDir) => {
    const packageDir = join(tmpDir, 'package')
    const configFile = await findConfigFile(packageDir)
    if (!configFile) throw new Error(`npm: no ra.config.{yaml,yml,json,toml} found in "${packageName}@${resolvedVersion}"`)

    const parts = recipeName.split('/')
    if (parts.length > 1) mkdirSync(join(installDir, parts[0] as string), { recursive: true })
    const targetDir = join(installDir, recipeName)
    cpSync(packageDir, targetDir, { recursive: true })
    writeFileSync(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
    return recipeName
  })
}

async function installFromUrl(url: string, installDir: string): Promise<string> {
  const source: Omit<RecipeSource, 'installedAt'> = { registry: 'url', url }

  return withTempExtract(installDir, url, 'url', async (tmpDir) => {
    const extractedRoot = await findExtractedRoot(tmpDir)
    const configFile = await findConfigFile(extractedRoot)
    if (!configFile) throw new Error(`url: no ra.config.{yaml,yml,json,toml} found at "${url}"`)

    // Derive name from URL path
    const urlPath = new URL(url).pathname
    const segments = urlPath.split('/').filter(Boolean)
    const recipeName = segments.length >= 2
      ? `${segments[segments.length - 2]}/${segments[segments.length - 1]}`.replace(/\.tar\.gz$|\.tgz$/, '')
      : segments[segments.length - 1]?.replace(/\.tar\.gz$|\.tgz$/, '') ?? 'recipe'

    const parts = recipeName.split('/')
    if (parts.length > 1) mkdirSync(join(installDir, parts[0] as string), { recursive: true })
    const targetDir = join(installDir, recipeName)
    cpSync(extractedRoot, targetDir, { recursive: true })
    writeFileSync(join(targetDir, '.source.json'), JSON.stringify({ ...source, installedAt: new Date().toISOString() }, null, 2))
    return recipeName
  })
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Install a recipe from a source string.
 * Returns the installed recipe name (owner/repo format).
 */
export async function installRecipe(source: string, installDir?: string): Promise<string> {
  const dir = installDir ?? defaultRecipeInstallDir()
  mkdirSync(dir, { recursive: true })

  const parsed = parseRecipeSource(source)
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
 * Remove an installed recipe by name (owner/repo format).
 */
export async function removeRecipe(recipeName: string, installDir?: string): Promise<void> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const recipeDir = join(dir, recipeName)
  try {
    rmSync(recipeDir, { recursive: true })
  } catch {
    throw new Error(`Recipe not found: ${recipeName} in ${dir}`)
  }

  // Clean up empty parent directory (owner dir)
  const parts = recipeName.split('/')
  if (parts.length > 1) {
    const parentDir = join(dir, parts[0] as string)
    try {
      const entries: string[] = []
      for await (const entry of new Bun.Glob('*').scan({ cwd: parentDir, onlyFiles: false })) {
        entries.push(entry)
      }
      if (entries.length === 0) rmSync(parentDir, { recursive: true })
    } catch { /* ignore */ }
  }
}

/**
 * List installed recipes with their source information.
 */
export async function listInstalledRecipes(installDir?: string): Promise<Array<{ name: string; source?: RecipeSource }>> {
  const dir = installDir ?? defaultRecipeInstallDir()
  const recipes: Array<{ name: string; source?: RecipeSource }> = []

  try {
    // Scan for owner/repo/ra.config.{yaml,yml,json,toml}
    for (const ext of ['yaml', 'yml', 'json', 'toml']) {
      for await (const rel of new Bun.Glob(`*/*/ra.config.${ext}`).scan({ cwd: dir, onlyFiles: true })) {
        const parts = rel.split(/[/\\]/)
        const name = `${parts[0]}/${parts[1]}`

        // Skip if already found via a different config extension
        if (recipes.some(r => r.name === name)) continue

        let source: RecipeSource | undefined
        try {
          const sourceFile = Bun.file(join(dir, name, '.source.json'))
          if (await sourceFile.exists()) {
            source = JSON.parse(await sourceFile.text()) as RecipeSource
          }
        } catch { /* no source info */ }
        recipes.push({ name, source })
      }
    }
  } catch { /* dir doesn't exist */ }

  return recipes
}

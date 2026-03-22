/** Source information for a recipe installed from a registry */
export interface RecipeSource {
  registry: 'npm' | 'github' | 'url'
  package?: string      // npm package name
  repo?: string         // github owner/repo
  url?: string          // raw URL
  version?: string      // installed version
  installedAt: string   // ISO timestamp
}

/**
 * Import a module with cache invalidation.
 *
 * Clears the previous cache entry for the same path before importing,
 * so Bun re-reads the file from disk.  Without this, `import()` returns
 * a stale cached module even after the file has been modified.
 */
export async function importFresh(absolutePath: string): Promise<Record<string, unknown>> {
  // Remove any existing cache entries for this path (with or without query strings)
  for (const key of Object.keys(require.cache)) {
    if (key === absolutePath || key.startsWith(absolutePath + '?')) {
      delete require.cache[key]
    }
  }
  return import(absolutePath)
}

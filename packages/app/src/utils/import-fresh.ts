/**
 * Import a module with cache invalidation.
 *
 * Bun's ESM module cache is keyed by the full specifier (including query
 * string), so we append a unique `?t=<mtime or now>` to force a fresh
 * evaluation of the file. `require.cache` only covers CommonJS and does
 * not affect dynamic ESM imports, which is why the previous implementation
 * silently returned stale modules on hot reload.
 */
export async function importFresh(absolutePath: string): Promise<Record<string, unknown>> {
  // Best-effort CommonJS eviction for any legacy consumers — harmless for ESM.
  for (const key of Object.keys(require.cache)) {
    if (key === absolutePath || key.startsWith(absolutePath + '?')) {
      delete require.cache[key]
    }
  }
  return import(`${absolutePath}?t=${Date.now()}`)
}

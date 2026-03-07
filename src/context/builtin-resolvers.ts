import { resolve, relative } from 'path'
import type { PatternResolver } from './resolvers'

/**
 * File resolver — matches @path/to/file references.
 * Supports direct file paths and glob patterns.
 */
export const fileResolver: PatternResolver = {
  name: 'file',
  // Matches @<path> where path is word chars, dots, slashes, hyphens, asterisks, braces
  // Stops at whitespace, commas, or end of string
  pattern: /@([\w.\/\-*{}[\]]+)/g,
  async resolve(ref: string, cwd: string): Promise<string | null> {
    // Check if it's a glob pattern
    if (ref.includes('*') || ref.includes('{') || ref.includes('[')) {
      return resolveGlob(ref, cwd)
    }
    return resolveFile(ref, cwd)
  },
}

async function resolveFile(ref: string, cwd: string): Promise<string | null> {
  const absPath = resolve(cwd, ref)
  const file = Bun.file(absPath)
  if (!(await file.exists())) return null
  const content = await file.text()
  const relPath = relative(cwd, absPath)
  return `[${relPath}]\n${content}`
}

async function resolveGlob(ref: string, cwd: string): Promise<string | null> {
  const glob = new Bun.Glob(ref)
  const parts: string[] = []
  for await (const match of glob.scan({ cwd, absolute: false, onlyFiles: true })) {
    const absPath = resolve(cwd, match)
    const content = await Bun.file(absPath).text()
    parts.push(`[${match}]\n${content}`)
  }
  if (parts.length === 0) return null
  return parts.join('\n\n')
}

/**
 * URL resolver — matches url:https://... references.
 * Fetches the URL and returns content as markdown.
 */
export const urlResolver: PatternResolver = {
  name: 'url',
  // Matches url:<scheme>://<rest> up to whitespace
  pattern: /url:(https?:\/\/[^\s,)>]+)/g,
  async resolve(ref: string): Promise<string | null> {
    try {
      const response = await fetch(ref)
      if (!response.ok) return `[${ref}] HTTP ${response.status}`
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('text/html')) {
        // Simple HTML to text — strip tags
        const html = await response.text()
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        return `[${ref}]\n${text.slice(0, 50_000)}`
      }
      const text = await response.text()
      return `[${ref}]\n${text.slice(0, 50_000)}`
    } catch (err) {
      return `[${ref}] Error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

/** All built-in resolvers, keyed by name. */
export const builtinResolvers: Record<string, PatternResolver> = {
  file: fileResolver,
  url: urlResolver,
}

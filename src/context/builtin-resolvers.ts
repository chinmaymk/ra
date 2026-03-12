import { errorMessage } from '../utils/errors'
import { resolve, relative } from 'path'
import type { PatternResolver } from './resolvers'

/**
 * File resolver — matches @path/to/file references.
 * Supports direct file paths and glob patterns.
 */
export const fileResolver: PatternResolver = {
  name: 'file',
  // Matches @<path> where path is word chars, dots, slashes, hyphens, asterisks, braces.
  // Negative lookbehind prevents matching email addresses (user@domain.com).
  pattern: /(?<!\w)@([\w.\/\-*{}[\]]+)/g,
  async resolve(ref: string, cwd: string): Promise<string | null> {
    if (ref.includes('*') || ref.includes('{') || ref.includes('[')) {
      return resolveGlob(ref, cwd)
    }
    return resolveFile(ref, cwd)
  },
}

async function resolveFile(ref: string, cwd: string): Promise<string | null> {
  const absPath = resolve(cwd, ref)
  // Prevent path traversal outside the working directory
  if (relative(cwd, absPath).startsWith('..')) return null
  try {
    const content = await Bun.file(absPath).text()
    return `[${relative(cwd, absPath)}]\n${content}`
  } catch {
    return null
  }
}

async function resolveGlob(ref: string, cwd: string): Promise<string | null> {
  const glob = new Bun.Glob(ref)
  const matches: string[] = []
  for await (const match of glob.scan({ cwd, absolute: false, onlyFiles: true })) {
    matches.push(match)
  }
  if (matches.length === 0) return null
  const results = await Promise.allSettled(
    matches.map(async (match) => {
      const content = await Bun.file(resolve(cwd, match)).text()
      return `[${match}]\n${content}`
    })
  )
  const parts = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value)
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
      const text = await response.text()
      if (contentType.includes('text/html')) {
        const stripped = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        return `[${ref}]\n${stripped.slice(0, 50_000)}`
      }
      return `[${ref}]\n${text.slice(0, 50_000)}`
    } catch (err) {
      return `[${ref}] Error: ${errorMessage(err)}`
    }
  },
}

/** All built-in resolvers, keyed by name. */
export const builtinResolvers: Record<string, PatternResolver> = {
  file: fileResolver,
  url: urlResolver,
}

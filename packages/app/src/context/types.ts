export interface ResolverConfig {
  /** Resolver name — matches a built-in resolver or used as identifier for custom ones */
  name: string
  /** Whether this resolver is enabled (default: true) */
  enabled: boolean
  /** For custom resolvers: path to a JS/TS file exporting a PatternResolver */
  path?: string
}

export interface ContextConfig {
  enabled: boolean
  patterns: string[]
  /** Pattern resolvers for inline references like @file or url:https://... */
  resolvers: ResolverConfig[]
  /** When true, discovering a file in a subdirectory also walks up from that
   *  directory to the project root, injecting any context files found along
   *  the way (not just in the immediate directory). Default: true. */
  subdirectoryWalk: boolean
}

export interface ContextFile {
  path: string
  relativePath: string
  content: string
}

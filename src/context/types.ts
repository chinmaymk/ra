export interface ContextConfig {
  enabled: boolean
  patterns: string[]
}

export interface ContextFile {
  path: string
  relativePath: string
  content: string
}

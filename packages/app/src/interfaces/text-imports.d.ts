declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.html' {
  const content: string
  export default content
}

declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked'
  export function markedTerminal(options?: Record<string, unknown>): MarkedExtension
}

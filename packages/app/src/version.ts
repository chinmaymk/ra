// These globals are replaced at compile time via `bun build --define`.
// When running from source they fall back to "dev".
declare const __RA_VERSION__: string
declare const __RA_COMMIT__: string

export const VERSION: string = typeof __RA_VERSION__ !== 'undefined' ? __RA_VERSION__ : 'dev'
export const COMMIT: string = typeof __RA_COMMIT__ !== 'undefined' ? __RA_COMMIT__ : 'dev'

export function versionString(): string {
  if (VERSION === 'dev') return 'ra dev'
  return COMMIT !== 'dev' ? `ra ${VERSION} (${COMMIT})` : `ra ${VERSION}`
}

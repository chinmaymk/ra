import { useEffect } from 'react'

interface Shortcut {
  /** Lowercase key (e.g. 'a', 'k', 'enter', 'escape', 'tab', '/') */
  key: string
  meta?: boolean
  shift?: boolean
  alt?: boolean
  /** Auto-prevent default when this shortcut fires */
  preventDefault?: boolean
  handler: (e: KeyboardEvent) => void
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA'])

export function useKeyboardShortcut(shortcuts: Shortcut[]) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      // Don't fire shortcuts while typing in inputs unless meta/ctrl is held
      const target = e.target as HTMLElement | null
      const inField = target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)
      const hasModifier = e.metaKey || e.ctrlKey

      const eventKey = e.key.toLowerCase()

      for (const s of shortcuts) {
        const wantsModifier = !!s.meta
        if (wantsModifier !== hasModifier) continue
        if (!!s.shift !== e.shiftKey) continue
        if (!!s.alt !== e.altKey) continue
        if (s.key.toLowerCase() !== eventKey) continue

        // Allow Escape and Tab in fields if explicitly bound and they have no modifier;
        // otherwise skip non-modifier shortcuts when typing
        if (inField && !hasModifier && s.key !== 'Escape' && s.key !== 'Tab') continue

        if (s.preventDefault !== false) e.preventDefault()
        s.handler(e)
        return
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [shortcuts])
}

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(import.meta.dir, 'inspector.html'), 'utf-8')

/** Extract all CSS rules from <style> blocks */
function extractStyles(src: string): string {
  const matches = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  return matches.map(m => m[1]).join('\n')
}

/** Rough CSS rule parser — returns { selector: declarations } */
function parseCSS(css: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {}
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const ruleRe = /([^{}]+)\{([^{}]+)\}/g
  let m
  while ((m = ruleRe.exec(css))) {
    const selector = m[1]!.trim()
    const decls: Record<string, string> = {}
    for (const d of m[2]!.split(';')) {
      const [prop, ...valParts] = d.split(':')
      if (prop && valParts.length) {
        decls[prop.trim()] = valParts.join(':').trim()
      }
    }
    rules[selector] = decls
  }
  return rules
}

describe('inspector sticky sub-tabs', () => {
  const css = extractStyles(html)
  const rules = parseCSS(css)

  test('#sub-tabs-container has position: sticky and top: 0', () => {
    const container = rules['#sub-tabs-container']!
    expect(container).toBeDefined()
    expect(container['position']).toBe('sticky')
    expect(container['top']).toBe('0')
  })

  test('#sub-tabs-container has z-index for stacking', () => {
    const container = rules['#sub-tabs-container']!
    expect(container).toBeDefined()
    expect(Number(container['z-index'])).toBeGreaterThanOrEqual(1)
  })

  test('.main has overflow-y: auto (scroll container)', () => {
    const main = rules['.main']!
    expect(main).toBeDefined()
    expect(main['overflow-y']).toBe('auto')
  })

  test('.main does NOT have display: flex (flex breaks sticky)', () => {
    const main = rules['.main']!
    expect(main).toBeDefined()
    expect(main['display']).toBeUndefined()
  })

  test('.sub-tabs does NOT have position: sticky (moved to container)', () => {
    const subTabs = rules['.sub-tabs']!
    expect(subTabs).toBeDefined()
    expect(subTabs['position']).toBeUndefined()
  })

  test('#sub-tabs-container is direct child of .main in HTML', () => {
    const mainMatch = html.match(/<div\s+class="main"[^>]*id="main"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<script/)
    expect(mainMatch).toBeTruthy()
    const mainContent = mainMatch![1]!
    const firstChild = mainContent.trim()
    expect(firstChild.startsWith('<div id="sub-tabs-container">')).toBe(true)
  })
})

import { test, expect } from 'bun:test'
import { loadWebPanels } from '../../src/web/panels/loader'

test('loadWebPanels registers builtin diff', async () => {
  const panels = await loadWebPanels(['diff'], '/tmp')
  expect(panels.map(p => ({ id: p.id, title: p.title, source: p.source }))).toEqual([
    { id: 'diff', title: 'Diff', source: 'builtin' },
  ])
})

test('loadWebPanels skips unknown builtin', async () => {
  const panels = await loadWebPanels(['diff', 'nope'], '/tmp')
  expect(panels.map(p => p.id)).toEqual(['diff'])
})

test('loadWebPanels empty list', async () => {
  const panels = await loadWebPanels([], '/tmp')
  expect(panels).toEqual([])
})

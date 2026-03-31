import { test, expect } from 'bun:test'
import { loadCustomTools } from '../../src/tools/loader'
import path from 'path'

const cwd = path.join(import.meta.dir, 'fixtures')

test('loads tool exported as plain object', async () => {
  const tools = await loadCustomTools(['./object-tool.ts'], cwd)
  expect(tools).toHaveLength(1)
  expect(tools[0]!.name).toBe('ObjectTool')
  expect(tools[0]!.description).toContain('plain object')
  const result = await tools[0]!.execute({ message: 'hello' })
  expect(result).toBe('echo: hello')
})

test('loads tool from factory function', async () => {
  const tools = await loadCustomTools(['./factory-tool.ts'], cwd)
  expect(tools).toHaveLength(1)
  expect(tools[0]!.name).toBe('FactoryTool')
  const result = await tools[0]!.execute({ count: 42 })
  expect(result).toBe('count: 42')
})

test('loads multiple tools at once', async () => {
  const tools = await loadCustomTools(['./object-tool.ts', './factory-tool.ts'], cwd)
  expect(tools).toHaveLength(2)
  const names = tools.map(t => t.name).sort()
  expect(names).toEqual(['FactoryTool', 'ObjectTool'])
})

test('preserves optional timeout field', async () => {
  const tools = await loadCustomTools(['./with-timeout.ts'], cwd)
  expect(tools).toHaveLength(1)
  expect(tools[0]!.timeout).toBe(5000)
})

test('returns empty array for empty input', async () => {
  const tools = await loadCustomTools([], cwd)
  expect(tools).toHaveLength(0)
})

test('throws on missing default export', async () => {
  await expect(loadCustomTools(['./no-default.ts'], cwd)).rejects.toThrow('default export')
})

test('throws on missing name', async () => {
  await expect(loadCustomTools(['./missing-name.ts'], cwd)).rejects.toThrow('missing a "name"')
})

test('throws on missing execute', async () => {
  await expect(loadCustomTools(['./missing-execute.ts'], cwd)).rejects.toThrow('missing an "execute"')
})

test('throws on nonexistent file', async () => {
  await expect(loadCustomTools(['./nonexistent.ts'], cwd)).rejects.toThrow('Failed to import')
})

test('throws on non-path entry', async () => {
  await expect(loadCustomTools(['some random string'], cwd)).rejects.toThrow('must be a file path')
})

test('loads tool with absolute path', async () => {
  const absPath = path.join(cwd, 'object-tool.ts')
  const tools = await loadCustomTools([absPath], cwd)
  expect(tools).toHaveLength(1)
  expect(tools[0]!.name).toBe('ObjectTool')
})

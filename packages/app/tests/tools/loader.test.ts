import { test, expect } from 'bun:test'
import { loadCustomTools, buildInputSchema } from '../../src/tools/loader'
import path from 'path'

const cwd = path.join(import.meta.dir, 'fixtures')

// ── buildInputSchema ──────────────────────────────────────────────

test('buildInputSchema converts parameters to JSON Schema', () => {
  const schema = buildInputSchema({
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Max results', optional: true },
  })
  expect(schema).toEqual({
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: ['query'],
  })
})

test('buildInputSchema omits required when all params are optional', () => {
  const schema = buildInputSchema({
    verbose: { type: 'boolean', optional: true },
  })
  expect(schema).toEqual({
    type: 'object',
    properties: {
      verbose: { type: 'boolean' },
    },
  })
})

test('buildInputSchema handles empty parameters', () => {
  const schema = buildInputSchema({})
  expect(schema).toEqual({ type: 'object', properties: {} })
})

// ── Full ITool object export (existing) ────────────────────────────

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

test('loads tool with absolute path', async () => {
  const absPath = path.join(cwd, 'object-tool.ts')
  const tools = await loadCustomTools([absPath], cwd)
  expect(tools).toHaveLength(1)
  expect(tools[0]!.name).toBe('ObjectTool')
})

// ── Parameters shorthand ──────────────────────────────────────────

test('object export with parameters shorthand builds inputSchema and infers name', async () => {
  const tools = await loadCustomTools(['./params-shorthand.ts'], cwd)
  expect(tools).toHaveLength(1)
  const tool = tools[0]!
  expect(tool.name).toBe('ParamsShorthand')
  expect(tool.inputSchema).toEqual({
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      recursive: { type: 'boolean', description: 'Recurse into subdirs' },
    },
    required: ['path'],
  })
  const result = await tool.execute({ path: '/tmp/test' })
  expect(result).toBe('reading: /tmp/test')
})

// ── Name inference ────────────────────────────────────────────────

test('infers name from filename when not specified', async () => {
  const tools = await loadCustomTools(['./infer-from-filename.ts'], cwd)
  expect(tools[0]!.name).toBe('InferFromFilename')
})

test('infers name from execute function name', async () => {
  const tools = await loadCustomTools(['./named-execute.ts'], cwd)
  expect(tools[0]!.name).toBe('FetchUrl')
})

// ── Named exports pattern ────────────────────────────────────────

test('loads tool from named exports (description + parameters + default function)', async () => {
  const tools = await loadCustomTools(['./named-exports.ts'], cwd)
  expect(tools).toHaveLength(1)
  const tool = tools[0]!
  expect(tool.name).toBe('Search')
  expect(tool.description).toContain('named exports')
  expect(tool.inputSchema).toEqual({
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: ['query'],
  })
  const result = await tool.execute({ query: 'test', limit: 5 })
  expect(result).toBe('query=test, limit=5')
})

// ── Error cases ──────────────────────────────────────────────────

test('throws on missing default export and no named execute', async () => {
  await expect(loadCustomTools(['./no-default.ts'], cwd)).rejects.toThrow('default export')
})

test('infers name from filename when name field is missing', async () => {
  const tools = await loadCustomTools(['./missing-name.ts'], cwd)
  expect(tools[0]!.name).toBe('MissingName')
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

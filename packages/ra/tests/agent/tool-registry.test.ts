import { describe, it, expect } from 'bun:test'
import { ToolRegistry, normalizeToolName } from '@chinmaymk/ra'

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'test', description: 'test', inputSchema: {}, execute: async () => ({}) })
    expect(reg.get('test')).toBeDefined()
    expect(reg.all()).toHaveLength(1)
  })

  it('returns undefined for unknown tool', () => {
    const reg = new ToolRegistry()
    expect(reg.get('missing')).toBeUndefined()
  })

  it('executes tool by name', async () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'add', description: 'add', inputSchema: {}, execute: async (input: any) => input.a + input.b })
    const result = await reg.execute('add', { a: 1, b: 2 })
    expect(result).toBe(3)
  })

  it('throws when executing unknown tool', async () => {
    const reg = new ToolRegistry()
    expect(reg.execute('missing', {})).rejects.toThrow()
  })

  it('registers multiple tools and lists all', () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'a', description: 'a', inputSchema: {}, execute: async () => null })
    reg.register({ name: 'b', description: 'b', inputSchema: {}, execute: async () => null })
    expect(reg.all()).toHaveLength(2)
  })

  it('re-registering a tool replaces the previous one', async () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'tool', description: 'v1', inputSchema: {}, execute: async () => 'v1' })
    reg.register({ name: 'tool', description: 'v2', inputSchema: {}, execute: async () => 'v2' })
    expect(reg.all()).toHaveLength(1)
    expect(reg.get('tool')!.description).toBe('v2')
    expect(await reg.execute('tool', {})).toBe('v2')
  })

  it('execute error includes tool name', async () => {
    const reg = new ToolRegistry()
    try {
      await reg.execute('nonexistent', {})
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain('nonexistent')
    }
  })

  it('empty registry returns empty array from all()', () => {
    const reg = new ToolRegistry()
    expect(reg.all()).toEqual([])
  })

  it('tool that throws propagates the error through execute()', async () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'boom', description: '', inputSchema: {}, execute: async () => { throw new Error('tool broke') } })
    await expect(reg.execute('boom', {})).rejects.toThrow('tool broke')
  })

  it('tool receives exact input passed to execute()', async () => {
    const reg = new ToolRegistry()
    let received: unknown
    reg.register({ name: 'capture', description: '', inputSchema: {}, execute: async (input) => { received = input; return 'ok' } })
    const complexInput = { nested: { arr: [1, 2], obj: { key: 'val' } }, flag: true }
    await reg.execute('capture', complexInput)
    expect(received).toEqual(complexInput)
  })
})

describe('normalizeToolName', () => {
  it('lowercases tool names', () => {
    expect(normalizeToolName('ReadFile')).toBe('readfile')
    expect(normalizeToolName('BASH')).toBe('bash')
  })

  it('replaces hyphens with underscores', () => {
    expect(normalizeToolName('read-file')).toBe('read_file')
    expect(normalizeToolName('web-fetch-url')).toBe('web_fetch_url')
  })

  it('handles combined normalization', () => {
    expect(normalizeToolName('Read-File')).toBe('read_file')
    expect(normalizeToolName('Web-Fetch')).toBe('web_fetch')
  })
})

describe('ToolRegistry name normalization', () => {
  it('finds tools case-insensitively', () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'ReadFile', description: '', inputSchema: {}, execute: async () => 'ok' })
    expect(reg.get('readfile')).toBeDefined()
    expect(reg.get('READFILE')).toBeDefined()
    expect(reg.get('ReadFile')).toBeDefined()
  })

  it('finds tools with hyphen/underscore normalization', () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'read_file', description: '', inputSchema: {}, execute: async () => 'ok' })
    expect(reg.get('read-file')).toBeDefined()
    expect(reg.get('Read-File')).toBeDefined()
    expect(reg.get('READ_FILE')).toBeDefined()
  })

  it('prefers exact match over normalized match', () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'read_file', description: 'underscore', inputSchema: {}, execute: async () => 'ok' })
    const tool = reg.get('read_file')
    expect(tool).toBeDefined()
    expect(tool!.description).toBe('underscore')
  })

  it('executes through normalized name', async () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'read_file', description: '', inputSchema: {}, execute: async () => 'found it' })
    const result = await reg.execute('Read-File', {})
    expect(result).toBe('found it')
  })

  it('still throws for truly unknown tools', async () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'bash', description: '', inputSchema: {}, execute: async () => 'ok' })
    expect(reg.get('totally_unknown')).toBeUndefined()
    await expect(reg.execute('totally_unknown', {})).rejects.toThrow('Tool not found')
  })
})

describe('ToolRegistry aliases', () => {
  it('resolves aliases to canonical tools', () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'read_file', description: '', inputSchema: {}, execute: async () => 'ok' })
    reg.alias('read', 'read_file')
    expect(reg.get('read')).toBeDefined()
    expect(reg.get('read')!.name).toBe('read_file')
  })

  it('alias lookup is case-insensitive', () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'bash', description: '', inputSchema: {}, execute: async () => 'ok' })
    reg.alias('shell', 'bash')
    expect(reg.get('Shell')).toBeDefined()
    expect(reg.get('SHELL')).toBeDefined()
  })

  it('executes through alias', async () => {
    const reg = new ToolRegistry()
    reg.register({ name: 'write_file', description: '', inputSchema: {}, execute: async () => 'written' })
    reg.alias('write', 'write_file')
    const result = await reg.execute('write', {})
    expect(result).toBe('written')
  })

  it('alias to nonexistent tool returns undefined', () => {
    const reg = new ToolRegistry()
    reg.alias('ghost', 'nonexistent_tool')
    expect(reg.get('ghost')).toBeUndefined()
  })
})

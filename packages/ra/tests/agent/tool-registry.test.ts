import { describe, it, expect } from 'bun:test'
import { ToolRegistry } from '@chinmaymk/ra'

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

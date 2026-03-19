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
})

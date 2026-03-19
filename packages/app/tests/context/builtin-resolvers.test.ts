import { describe, it, expect } from 'bun:test'
import { fileResolver } from '../../src/context/builtin-resolvers'
import { join } from 'path'
import { mkdtemp, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'

describe('fileResolver', () => {
  it('has name "file"', () => {
    expect(fileResolver.name).toBe('file')
  })

  it('pattern matches @path references', () => {
    const re = new RegExp(fileResolver.pattern.source, fileResolver.pattern.flags)
    const matches: string[] = []
    let m: RegExpExecArray | null
    const text = 'check @src/index.ts and @README.md'
    while ((m = re.exec(text)) !== null) {
      matches.push(m[1]!)
    }
    expect(matches).toEqual(['src/index.ts', 'README.md'])
  })

  it('pattern matches glob patterns', () => {
    const re = new RegExp(fileResolver.pattern.source, fileResolver.pattern.flags)
    const text = 'check @src/**/*.ts'
    const m = re.exec(text)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('src/**/*.ts')
  })

  it('resolves an existing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ra-test-'))
    await writeFile(join(dir, 'hello.txt'), 'hello world')
    const result = await fileResolver.resolve('hello.txt', dir)
    expect(result).toContain('hello world')
    expect(result).toContain('hello.txt')
  })

  it('returns null for non-existent file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ra-test-'))
    const result = await fileResolver.resolve('nope.txt', dir)
    expect(result).toBeNull()
  })

  it('resolves glob patterns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ra-test-'))
    await writeFile(join(dir, 'a.txt'), 'aaa')
    await writeFile(join(dir, 'b.txt'), 'bbb')
    await writeFile(join(dir, 'c.md'), 'ccc')
    const result = await fileResolver.resolve('*.txt', dir)
    expect(result).not.toBeNull()
    expect(result).toContain('aaa')
    expect(result).toContain('bbb')
    expect(result).not.toContain('ccc')
  })

  it('returns null when glob matches nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ra-test-'))
    const result = await fileResolver.resolve('*.xyz', dir)
    expect(result).toBeNull()
  })

  it('does not match email addresses', () => {
    const re = new RegExp(fileResolver.pattern.source, fileResolver.pattern.flags)
    const text = 'send to user@example.com for help'
    const m = re.exec(text)
    expect(m).toBeNull()
  })

  it('matches @ at start of line', () => {
    const re = new RegExp(fileResolver.pattern.source, fileResolver.pattern.flags)
    const text = '@src/index.ts is the entry point'
    const m = re.exec(text)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('src/index.ts')
  })

  it('matches @ after whitespace', () => {
    const re = new RegExp(fileResolver.pattern.source, fileResolver.pattern.flags)
    const text = 'check @src/utils.ts please'
    const m = re.exec(text)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('src/utils.ts')
  })

  it('blocks path traversal outside cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ra-test-'))
    await writeFile(join(dir, 'safe.txt'), 'safe content')
    // Traversal attempt
    const result = await fileResolver.resolve('../../etc/passwd', dir)
    expect(result).toBeNull()
  })

  it('allows files within cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ra-test-'))
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'file.txt'), 'nested content')
    const result = await fileResolver.resolve('sub/file.txt', dir)
    expect(result).not.toBeNull()
    expect(result).toContain('nested content')
  })
})

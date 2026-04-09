import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { readFileTool } from '../../src/tools/read-file'
import { writeFileTool } from '../../src/tools/write-file'
import { updateFileTool } from '../../src/tools/update-file'
import { appendFileTool } from '../../src/tools/append-file'
import { listDirectoryTool } from '../../src/tools/list-directory'
import { searchFilesTool } from '../../src/tools/search-files'
import { globFilesTool } from '../../src/tools/glob-files'
import { moveFileTool } from '../../src/tools/move-file'
import { copyFileTool } from '../../src/tools/copy-file'
import { deleteFileTool } from '../../src/tools/delete-file'
import { executeBashTool } from '../../src/tools/shell-exec'
import { webFetchTool } from '../../src/tools/web-fetch'
import { registerBuiltinTools } from '../../src/tools'
import { ToolRegistry } from '@chinmaymk/ra'

const TMP = join(import.meta.dir, '.tmp-builtin-tools')

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(join(TMP, 'src'), { recursive: true })
  mkdirSync(join(TMP, 'sub'), { recursive: true })
  writeFileSync(join(TMP, 'hello.txt'), 'line1\nline2\nline3\nline4\nline5\n')
  writeFileSync(join(TMP, 'src', 'app.ts'), 'function hello() {\n  return "world"\n}')
  writeFileSync(join(TMP, 'src', 'util.ts'), 'export const x = 1')
  writeFileSync(join(TMP, 'sub', 'deep.ts'), 'const hello = 42')
  writeFileSync(join(TMP, 'readme.md'), '# readme')
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('Read', () => {
  const tool = readFileTool()

  it('reads file with line numbers and supports offset/limit', async () => {
    const full = await tool.execute({ path: join(TMP, 'hello.txt') }) as string
    expect(full).toBe('1: line1\n2: line2\n3: line3\n4: line4\n5: line5')

    const slice = await tool.execute({ path: join(TMP, 'hello.txt'), offset: 2, limit: 2 }) as string
    expect(slice).toBe('2: line2\n3: line3')
  })

  it('throws on missing file', () => {
    expect(tool.execute({ path: join(TMP, 'nope.txt') })).rejects.toThrow()
  })
})

describe('Write', () => {
  const tool = writeFileTool()

  it('creates files with nested dirs and overwrites', async () => {
    const p = join(TMP, 'write', 'deep', 'file.txt')
    await tool.execute({ path: p, content: 'first' })
    expect(readFileSync(p, 'utf-8')).toBe('first')

    await tool.execute({ path: p, content: 'second' })
    expect(readFileSync(p, 'utf-8')).toBe('second')
  })
})

describe('Edit', () => {
  const tool = updateFileTool()

  it('replaces first occurrence only and errors on missing string', async () => {
    const p = join(TMP, 'update.txt')
    writeFileSync(p, 'aaa bbb aaa')
    await tool.execute({ path: p, old_string: 'aaa', new_string: 'ccc' })
    expect(readFileSync(p, 'utf-8')).toBe('ccc bbb aaa')

    expect(tool.execute({ path: p, old_string: 'missing', new_string: 'x' })).rejects.toThrow('not found')
  })

  it('handles multi-line replacements', async () => {
    const p = join(TMP, 'update-multi.txt')
    writeFileSync(p, 'line1\nline2\nline3')
    await tool.execute({ path: p, old_string: 'line1\nline2', new_string: 'replaced' })
    expect(readFileSync(p, 'utf-8')).toBe('replaced\nline3')
  })
})

describe('AppendFile', () => {
  const tool = appendFileTool()

  it('appends to existing and creates new files', async () => {
    const existing = join(TMP, 'append-existing.txt')
    writeFileSync(existing, 'hello')
    await tool.execute({ path: existing, content: ' world' })
    expect(readFileSync(existing, 'utf-8')).toBe('hello world')

    const newFile = join(TMP, 'append-new.txt')
    await tool.execute({ path: newFile, content: 'created' })
    expect(readFileSync(newFile, 'utf-8')).toBe('created')
  })
})

describe('LS', () => {
  it('lists entries with trailing / for directories', async () => {
    const tool = listDirectoryTool()
    const result = await tool.execute({ path: TMP }) as string
    expect(result).toContain('hello.txt')
    expect(result).toContain('src/')
    expect(result).toContain('sub/')
    // non-recursive should not include nested files
    expect(result).not.toContain('app.ts')
  })

  it('lists recursively with default depth', async () => {
    const tool = listDirectoryTool()
    const result = await tool.execute({ path: TMP, recursive: true }) as string
    expect(result).toContain('src/')
    expect(result).toContain('src/app.ts')
    expect(result).toContain('src/util.ts')
    expect(result).toContain('sub/')
    expect(result).toContain('sub/deep.ts')
    expect(result).toContain('hello.txt')
  })

  it('respects depth limit', async () => {
    // Create a deeper structure: TMP/a/b/c/file.txt
    mkdirSync(join(TMP, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(TMP, 'a', 'b', 'c', 'file.txt'), 'deep')

    const tool = listDirectoryTool()
    // depth=2: lists 2 levels — a/ and a/b/, but not a/b/c/
    const shallow = await tool.execute({ path: TMP, recursive: true, depth: 2 }) as string
    expect(shallow).toContain('a/')
    expect(shallow).toContain('a/b/')
    expect(shallow).not.toContain('a/b/c/')

    // depth=4: lists 4 levels — reaches a/b/c/file.txt
    const deeper = await tool.execute({ path: TMP, recursive: true, depth: 4 }) as string
    expect(deeper).toContain('a/b/c/')
    expect(deeper).toContain('a/b/c/file.txt')
  })
})

describe('Grep', () => {
  it('finds matches recursively with file:line:content format and supports include filter', async () => {
    const tool = searchFilesTool()
    const result = await tool.execute({ path: TMP, pattern: 'hello' }) as string
    expect(result).toContain('src/app.ts:1:function hello()')
    expect(result).toContain('sub/deep.ts:1:const hello = 42')
    expect(result).not.toContain('readme.md')

    const filtered = await tool.execute({ path: TMP, pattern: 'hello', include: '*.ts' }) as string
    expect(filtered).toContain('app.ts')
    expect(filtered).not.toContain('readme')
  })
})

describe('Glob', () => {
  it('matches glob patterns', async () => {
    const tool = globFilesTool()
    const ts = await tool.execute({ path: TMP, pattern: '**/*.ts' }) as string
    expect(ts).toContain('app.ts')
    expect(ts).toContain('util.ts')
    expect(ts).not.toContain('readme.md')

    const none = await tool.execute({ path: TMP, pattern: '**/*.xyz' }) as string
    expect(none).toContain('No files found')
  })
})

describe('MoveFile', () => {
  it('moves file and creates destination dirs', async () => {
    const tool = moveFileTool()
    const src = join(TMP, 'move-src.txt')
    const dst = join(TMP, 'moved', 'nested', 'dst.txt')
    writeFileSync(src, 'moveme')
    await tool.execute({ source: src, destination: dst })
    expect(existsSync(src)).toBe(false)
    expect(readFileSync(dst, 'utf-8')).toBe('moveme')
  })
})

describe('CopyFile', () => {
  it('copies files and directories recursively', async () => {
    const tool = copyFileTool()
    const srcDir = join(TMP, 'copy-src')
    mkdirSync(join(srcDir, 'nested'), { recursive: true })
    writeFileSync(join(srcDir, 'a.txt'), 'hello')
    writeFileSync(join(srcDir, 'nested', 'b.txt'), 'deep')

    const dstDir = join(TMP, 'copy-dst')
    await tool.execute({ source: srcDir, destination: dstDir })
    expect(existsSync(join(srcDir, 'a.txt'))).toBe(true) // source preserved
    expect(readFileSync(join(dstDir, 'a.txt'), 'utf-8')).toBe('hello')
    expect(readFileSync(join(dstDir, 'nested', 'b.txt'), 'utf-8')).toBe('deep')
  })
})

describe('DeleteFile', () => {
  it('deletes files and directories, errors on non-existent', async () => {
    const tool = deleteFileTool()
    const dir = join(TMP, 'del-dir')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'f.txt'), 'x')
    await tool.execute({ path: dir })
    expect(existsSync(dir)).toBe(false)

    expect(tool.execute({ path: join(TMP, 'nope') })).rejects.toThrow()
  })
})

describe('Bash', () => {
  if (process.platform === 'win32') return

  const tool = executeBashTool()

  it('runs commands and returns combined stdout/stderr', async () => {
    const result = await tool.execute({ command: 'echo hello && echo err >&2' }) as string
    expect(result).toContain('hello')
    expect(result).toContain('err')
  })

  it('rejects on timeout', () => {
    expect(tool.execute({ command: 'sleep 60', timeout: 500 })).rejects.toThrow('timed out')
  })
})

describe('WebFetch', () => {
  it('makes HTTP requests and returns structured response', async () => {
    let receivedBody = ''
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === 'POST') {
          receivedBody = await req.text()
          return new Response('posted')
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    try {
      const tool = webFetchTool()
      // GET
      const get = JSON.parse(await tool.execute({ url: `http://localhost:${server.port}` }) as string)
      expect(get.status).toBe(200)
      expect(get.body).toContain('ok')

      // POST
      await tool.execute({ url: `http://localhost:${server.port}`, method: 'POST', body: '{"k":"v"}' })
      expect(receivedBody).toBe('{"k":"v"}')
    } finally {
      server.stop(true)
    }
  })
})

describe('registerBuiltinTools', () => {
  it('registers all 12 tools with platform-specific shell', () => {
    const registry = new ToolRegistry()
    registerBuiltinTools(registry)
    const names = registry.all().map(t => t.name)

    expect(names).toHaveLength(12)
    expect(names).toContain('Read')
    expect(names).toContain('Write')
    expect(names).toContain('Edit')
    expect(names).toContain('AppendFile')
    expect(names).toContain('LS')
    expect(names).toContain('Grep')
    expect(names).toContain('Glob')
    expect(names).toContain('MoveFile')
    expect(names).toContain('CopyFile')
    expect(names).toContain('DeleteFile')
    expect(names).toContain('WebFetch')
    expect(names).toContain(process.platform === 'win32' ? 'PowerShell' : 'Bash')
  })

  it('disables individual tools via per-tool settings', () => {
    const registry = new ToolRegistry()
    registerBuiltinTools(registry, {
      builtin: true,
      WebFetch: { enabled: false },
      DeleteFile: { enabled: false },
    })
    const names = registry.all().map(t => t.name)
    expect(names).not.toContain('WebFetch')
    expect(names).not.toContain('DeleteFile')
    expect(names).toContain('Read')
    expect(names).toContain('Write')
    expect(names).toHaveLength(10)
  })

  it('registers no tools when builtin is false', () => {
    const registry = new ToolRegistry()
    registerBuiltinTools(registry, { builtin: false })
    expect(registry.all()).toHaveLength(0)
  })

  it('enforces rootDir on file tools', async () => {
    const registry = new ToolRegistry()
    registerBuiltinTools(registry, {
      builtin: true,
      Read: { rootDir: TMP },
    })
    const read = registry.get('Read')!
    // Reading within rootDir should work
    const result = await read.execute({ path: join(TMP, 'hello.txt') })
    expect(result).toContain('line1')

    // Reading outside rootDir should throw
    expect(read.execute({ path: '/etc/passwd' })).rejects.toThrow('outside the allowed root directory')
  })
})

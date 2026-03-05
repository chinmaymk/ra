# Built-in Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 14 built-in tools (filesystem, shell, network, agent interaction) to ra, configurable via `builtinTools` flag, and exposed via MCP server mode.

**Architecture:** Each tool is a standalone file in `src/tools/` exporting an `ITool`. A `registerBuiltinTools()` function registers them into the existing `ToolRegistry`. The `ask_user` tool signals the loop to break via a special return. Config, env vars, CLI flags, and parse-args all get `builtinTools` support.

**Tech Stack:** Bun APIs (`Bun.file`, `Bun.$`), Node.js `fs/promises` for cross-platform filesystem ops, `node:child_process` for shell execution.

---

### Task 1: Config — Add `builtinTools` flag

**Files:**
- Modify: `src/config/types.ts:10-46` (add field to `RaConfig`)
- Modify: `src/config/defaults.ts:1-43` (add default value)
- Modify: `src/config/index.ts:76-127` (add env var loading)
- Modify: `src/interfaces/parse-args.ts:54-101` (add CLI flag)
- Test: `tests/config/index.test.ts`
- Test: `tests/config/parse-args.test.ts`

**Step 1: Write failing tests**

In `tests/config/index.test.ts`, add:

```typescript
it('loads builtinTools from env var', async () => {
  const config = await loadConfig({ env: { RA_BUILTIN_TOOLS: 'true' } })
  expect(config.builtinTools).toBe(true)
})

it('defaults builtinTools to false', async () => {
  const config = await loadConfig({ env: {} })
  expect(config.builtinTools).toBe(false)
})
```

In `tests/config/parse-args.test.ts`, add:

```typescript
it('parses --builtin-tools flag', () => {
  const result = parseArgs(['node', 'ra', '--builtin-tools'])
  expect(result.config.builtinTools).toBe(true)
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/config/index.test.ts tests/config/parse-args.test.ts`
Expected: FAIL — `builtinTools` not defined

**Step 3: Add `builtinTools` to types, defaults, config loading, and parse-args**

In `src/config/types.ts`, add to `RaConfig`:
```typescript
builtinTools: boolean
```

In `src/config/defaults.ts`, add to `defaultConfig`:
```typescript
builtinTools: false,
```

In `src/config/index.ts`, in `loadEnvVars()`, add:
```typescript
if (env.RA_BUILTIN_TOOLS !== undefined) set(['builtinTools'], env.RA_BUILTIN_TOOLS === 'true')
```

In `src/interfaces/parse-args.ts`, add to options object:
```typescript
'builtin-tools': { type: 'boolean' },
```

And in the mapping section:
```typescript
if (values['builtin-tools']) set(['builtinTools'], true)
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/config/index.test.ts tests/config/parse-args.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/types.ts src/config/defaults.ts src/config/index.ts src/interfaces/parse-args.ts tests/config/index.test.ts tests/config/parse-args.test.ts
git commit -m "feat: add builtinTools config flag"
```

---

### Task 2: Tool — `read_file`

**Files:**
- Create: `src/tools/read-file.ts`
- Test: `tests/tools/read-file.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { readFileTool } from '../../src/tools/read-file'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-read-file')

beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
  writeFileSync(join(TMP, 'hello.txt'), 'line1\nline2\nline3\nline4\nline5\n')
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('read_file', () => {
  it('has correct tool metadata', () => {
    const tool = readFileTool()
    expect(tool.name).toBe('read_file')
    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeDefined()
  })

  it('reads entire file', async () => {
    const tool = readFileTool()
    const result = await tool.execute({ path: join(TMP, 'hello.txt') }) as string
    expect(result).toContain('line1')
    expect(result).toContain('line5')
  })

  it('reads with offset and limit', async () => {
    const tool = readFileTool()
    const result = await tool.execute({ path: join(TMP, 'hello.txt'), offset: 2, limit: 2 }) as string
    expect(result).toContain('line2')
    expect(result).toContain('line3')
    expect(result).not.toContain('line1')
    expect(result).not.toContain('line4')
  })

  it('returns line numbers', async () => {
    const tool = readFileTool()
    const result = await tool.execute({ path: join(TMP, 'hello.txt') }) as string
    expect(result).toContain('1:')
  })

  it('throws on missing file', async () => {
    const tool = readFileTool()
    expect(tool.execute({ path: join(TMP, 'nope.txt') })).rejects.toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/read-file.test.ts`
Expected: FAIL — module not found

**Step 3: Implement**

```typescript
// src/tools/read-file.ts
import type { ITool } from '../providers/types'
import { readFile } from 'fs/promises'

export function readFileTool(): ITool {
  return {
    name: 'read_file',
    description:
      'Read the contents of a file at the given path. Returns the file content with line numbers prefixed (e.g. "1: first line"). ' +
      'Use the optional `offset` (1-based line number) and `limit` (number of lines) parameters to read a specific range of lines from large files. ' +
      'If no offset/limit is provided, the entire file is returned.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file to read' },
        offset: { type: 'number', description: 'Start reading from this line number (1-based). Optional.' },
        limit: { type: 'number', description: 'Maximum number of lines to return. Optional.' },
      },
      required: ['path'],
    },
    async execute(input: unknown) {
      const { path, offset, limit } = input as { path: string; offset?: number; limit?: number }
      const content = await readFile(path, 'utf-8')
      let lines = content.split('\n')

      // Remove trailing empty line from split
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

      const startLine = offset ? Math.max(1, offset) : 1
      const startIdx = startLine - 1
      const endIdx = limit ? startIdx + limit : lines.length

      lines = lines.slice(startIdx, endIdx)
      return lines.map((line, i) => `${startLine + i}: ${line}`).join('\n')
    },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/read-file.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/read-file.ts tests/tools/read-file.test.ts
git commit -m "feat: add read_file built-in tool"
```

---

### Task 3: Tool — `write_file`

**Files:**
- Create: `src/tools/write-file.ts`
- Test: `tests/tools/write-file.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, afterAll } from 'bun:test'
import { writeFileTool } from '../../src/tools/write-file'
import { readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-write-file')

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('write_file', () => {
  it('has correct tool metadata', () => {
    const tool = writeFileTool()
    expect(tool.name).toBe('write_file')
    expect(tool.inputSchema).toBeDefined()
  })

  it('creates file with content', async () => {
    const tool = writeFileTool()
    const p = join(TMP, 'test.txt')
    await tool.execute({ path: p, content: 'hello world' })
    expect(readFileSync(p, 'utf-8')).toBe('hello world')
  })

  it('creates parent directories', async () => {
    const tool = writeFileTool()
    const p = join(TMP, 'deep', 'nested', 'file.txt')
    await tool.execute({ path: p, content: 'nested content' })
    expect(readFileSync(p, 'utf-8')).toBe('nested content')
  })

  it('overwrites existing file', async () => {
    const tool = writeFileTool()
    const p = join(TMP, 'overwrite.txt')
    await tool.execute({ path: p, content: 'first' })
    await tool.execute({ path: p, content: 'second' })
    expect(readFileSync(p, 'utf-8')).toBe('second')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/write-file.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
// src/tools/write-file.ts
import type { ITool } from '../providers/types'
import { writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function writeFileTool(): ITool {
  return {
    name: 'write_file',
    description:
      'Create or overwrite a file at the given path with the provided content. ' +
      'Parent directories are created automatically if they do not exist. ' +
      'If the file already exists, it will be completely replaced with the new content. ' +
      'Use update_file instead if you only want to change part of an existing file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file to write' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['path', 'content'],
    },
    async execute(input: unknown) {
      const { path, content } = input as { path: string; content: string }
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf-8')
      return `File written: ${path}`
    },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/write-file.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/write-file.ts tests/tools/write-file.test.ts
git commit -m "feat: add write_file built-in tool"
```

---

### Task 4: Tool — `update_file`

**Files:**
- Create: `src/tools/update-file.ts`
- Test: `tests/tools/update-file.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { updateFileTool } from '../../src/tools/update-file'
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-update-file')

beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('update_file', () => {
  it('has correct tool metadata', () => {
    const tool = updateFileTool()
    expect(tool.name).toBe('update_file')
  })

  it('replaces old_string with new_string', async () => {
    const tool = updateFileTool()
    const p = join(TMP, 'replace.txt')
    writeFileSync(p, 'hello world')
    await tool.execute({ path: p, old_string: 'world', new_string: 'ra' })
    expect(readFileSync(p, 'utf-8')).toBe('hello ra')
  })

  it('replaces only first occurrence by default', async () => {
    const tool = updateFileTool()
    const p = join(TMP, 'first-only.txt')
    writeFileSync(p, 'aaa bbb aaa')
    await tool.execute({ path: p, old_string: 'aaa', new_string: 'ccc' })
    expect(readFileSync(p, 'utf-8')).toBe('ccc bbb aaa')
  })

  it('throws if old_string not found', async () => {
    const tool = updateFileTool()
    const p = join(TMP, 'notfound.txt')
    writeFileSync(p, 'hello world')
    expect(tool.execute({ path: p, old_string: 'missing', new_string: 'x' })).rejects.toThrow()
  })

  it('handles multi-line replacements', async () => {
    const tool = updateFileTool()
    const p = join(TMP, 'multi.txt')
    writeFileSync(p, 'line1\nline2\nline3')
    await tool.execute({ path: p, old_string: 'line1\nline2', new_string: 'replaced' })
    expect(readFileSync(p, 'utf-8')).toBe('replaced\nline3')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/update-file.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
// src/tools/update-file.ts
import type { ITool } from '../providers/types'
import { readFile, writeFile } from 'fs/promises'

export function updateFileTool(): ITool {
  return {
    name: 'update_file',
    description:
      'Update a file by replacing the first occurrence of `old_string` with `new_string`. ' +
      'The old_string must match exactly (including whitespace and indentation). ' +
      'Only the first occurrence is replaced. ' +
      'Use this for surgical edits to existing files. For creating new files, use write_file instead.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to update' },
        old_string: { type: 'string', description: 'The exact string to find in the file' },
        new_string: { type: 'string', description: 'The string to replace old_string with' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(input: unknown) {
      const { path, old_string, new_string } = input as { path: string; old_string: string; new_string: string }
      const content = await readFile(path, 'utf-8')
      if (!content.includes(old_string)) {
        throw new Error(`old_string not found in ${path}. Make sure the string matches exactly, including whitespace and indentation.`)
      }
      const updated = content.replace(old_string, new_string)
      await writeFile(path, updated, 'utf-8')
      return `File updated: ${path}`
    },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/update-file.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/update-file.ts tests/tools/update-file.test.ts
git commit -m "feat: add update_file built-in tool"
```

---

### Task 5: Tool — `append_file`

**Files:**
- Create: `src/tools/append-file.ts`
- Test: `tests/tools/append-file.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, afterAll } from 'bun:test'
import { appendFileTool } from '../../src/tools/append-file'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-append-file')

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('append_file', () => {
  it('appends to existing file', async () => {
    const tool = appendFileTool()
    mkdirSync(TMP, { recursive: true })
    const p = join(TMP, 'existing.txt')
    writeFileSync(p, 'hello')
    await tool.execute({ path: p, content: ' world' })
    expect(readFileSync(p, 'utf-8')).toBe('hello world')
  })

  it('creates file if it does not exist', async () => {
    const tool = appendFileTool()
    const p = join(TMP, 'new.txt')
    await tool.execute({ path: p, content: 'created' })
    expect(readFileSync(p, 'utf-8')).toBe('created')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/append-file.test.ts`

**Step 3: Implement**

```typescript
// src/tools/append-file.ts
import type { ITool } from '../providers/types'
import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function appendFileTool(): ITool {
  return {
    name: 'append_file',
    description:
      'Append content to the end of a file. Creates the file (and parent directories) if it does not exist. ' +
      'Does not add any separator — if you need a newline before the appended content, include it in the content string.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to append to' },
        content: { type: 'string', description: 'Content to append to the end of the file' },
      },
      required: ['path', 'content'],
    },
    async execute(input: unknown) {
      const { path, content } = input as { path: string; content: string }
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, content, 'utf-8')
      return `Content appended to: ${path}`
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/append-file.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/append-file.ts tests/tools/append-file.test.ts
git commit -m "feat: add append_file built-in tool"
```

---

### Task 6: Tool — `list_directory`

**Files:**
- Create: `src/tools/list-directory.ts`
- Test: `tests/tools/list-directory.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { listDirectoryTool } from '../../src/tools/list-directory'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-list-dir')

beforeAll(() => {
  mkdirSync(join(TMP, 'subdir'), { recursive: true })
  writeFileSync(join(TMP, 'file1.txt'), 'content')
  writeFileSync(join(TMP, 'file2.ts'), 'content')
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('list_directory', () => {
  it('lists files and directories', async () => {
    const tool = listDirectoryTool()
    const result = await tool.execute({ path: TMP }) as string
    expect(result).toContain('file1.txt')
    expect(result).toContain('file2.ts')
    expect(result).toContain('subdir')
  })

  it('indicates directories vs files', async () => {
    const tool = listDirectoryTool()
    const result = await tool.execute({ path: TMP }) as string
    expect(result).toContain('subdir/')
  })

  it('throws on non-existent path', async () => {
    const tool = listDirectoryTool()
    expect(tool.execute({ path: join(TMP, 'nope') })).rejects.toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/list-directory.test.ts`

**Step 3: Implement**

```typescript
// src/tools/list-directory.ts
import type { ITool } from '../providers/types'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

export function listDirectoryTool(): ITool {
  return {
    name: 'list_directory',
    description:
      'List the files and directories at the given path. ' +
      'Returns one entry per line. Directories have a trailing "/" to distinguish them from files. ' +
      'Does not recurse into subdirectories — only lists the immediate children.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the directory to list' },
      },
      required: ['path'],
    },
    async execute(input: unknown) {
      const { path } = input as { path: string }
      const entries = await readdir(path)
      const results: string[] = []
      for (const entry of entries) {
        const s = await stat(join(path, entry))
        results.push(s.isDirectory() ? `${entry}/` : entry)
      }
      return results.join('\n')
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/list-directory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/list-directory.ts tests/tools/list-directory.test.ts
git commit -m "feat: add list_directory built-in tool"
```

---

### Task 7: Tool — `search_files`

**Files:**
- Create: `src/tools/search-files.ts`
- Test: `tests/tools/search-files.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { searchFilesTool } from '../../src/tools/search-files'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-search-files')

beforeAll(() => {
  mkdirSync(join(TMP, 'sub'), { recursive: true })
  writeFileSync(join(TMP, 'a.ts'), 'function hello() {\n  return "world"\n}')
  writeFileSync(join(TMP, 'b.txt'), 'no match here')
  writeFileSync(join(TMP, 'sub', 'c.ts'), 'const hello = 42')
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('search_files', () => {
  it('finds matching lines across files recursively', async () => {
    const tool = searchFilesTool()
    const result = await tool.execute({ path: TMP, pattern: 'hello' }) as string
    expect(result).toContain('a.ts')
    expect(result).toContain('c.ts')
    expect(result).not.toContain('b.txt')
  })

  it('returns line numbers', async () => {
    const tool = searchFilesTool()
    const result = await tool.execute({ path: TMP, pattern: 'hello' }) as string
    expect(result).toMatch(/:\d+:/)
  })

  it('supports file pattern filter', async () => {
    const tool = searchFilesTool()
    const result = await tool.execute({ path: TMP, pattern: 'hello', include: '*.ts' }) as string
    expect(result).toContain('a.ts')
    expect(result).toContain('c.ts')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/search-files.test.ts`

**Step 3: Implement**

```typescript
// src/tools/search-files.ts
import type { ITool } from '../providers/types'
import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'

async function* walkFiles(dir: string, include?: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      yield* walkFiles(full, include)
    } else {
      if (include) {
        const pattern = include.replace(/\*/g, '.*').replace(/\?/g, '.')
        if (!new RegExp(`^${pattern}$`).test(entry.name)) continue
      }
      yield full
    }
  }
}

export function searchFilesTool(): ITool {
  return {
    name: 'search_files',
    description:
      'Search for a text pattern across files in a directory, recursively. ' +
      'Returns matching lines with file paths and line numbers in the format "path:line:content". ' +
      'Skips node_modules and .git directories. ' +
      'Use the optional `include` parameter to filter by filename pattern (e.g. "*.ts", "*.json"). ' +
      'The pattern is matched as a plain string (not regex).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search in' },
        pattern: { type: 'string', description: 'Text pattern to search for' },
        include: { type: 'string', description: 'Optional filename glob filter, e.g. "*.ts"' },
      },
      required: ['path', 'pattern'],
    },
    async execute(input: unknown) {
      const { path, pattern, include } = input as { path: string; pattern: string; include?: string }
      const results: string[] = []

      for await (const file of walkFiles(path, include)) {
        try {
          const content = await readFile(file, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes(pattern)) {
              results.push(`${relative(path, file)}:${i + 1}:${lines[i]}`)
            }
          }
        } catch {
          // skip binary/unreadable files
        }
      }

      return results.length ? results.join('\n') : `No matches found for "${pattern}"`
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/search-files.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/search-files.ts tests/tools/search-files.test.ts
git commit -m "feat: add search_files built-in tool"
```

---

### Task 8: Tool — `glob_files`

**Files:**
- Create: `src/tools/glob-files.ts`
- Test: `tests/tools/glob-files.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { globFilesTool } from '../../src/tools/glob-files'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-glob-files')

beforeAll(() => {
  mkdirSync(join(TMP, 'src'), { recursive: true })
  writeFileSync(join(TMP, 'src', 'app.ts'), '')
  writeFileSync(join(TMP, 'src', 'util.ts'), '')
  writeFileSync(join(TMP, 'readme.md'), '')
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('glob_files', () => {
  it('finds files matching glob pattern', async () => {
    const tool = globFilesTool()
    const result = await tool.execute({ path: TMP, pattern: '**/*.ts' }) as string
    expect(result).toContain('app.ts')
    expect(result).toContain('util.ts')
    expect(result).not.toContain('readme.md')
  })

  it('returns no matches message when nothing found', async () => {
    const tool = globFilesTool()
    const result = await tool.execute({ path: TMP, pattern: '**/*.xyz' }) as string
    expect(result).toContain('No files found')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/glob-files.test.ts`

**Step 3: Implement**

```typescript
// src/tools/glob-files.ts
import type { ITool } from '../providers/types'
import { Glob } from 'bun'
import { relative } from 'path'

export function globFilesTool(): ITool {
  return {
    name: 'glob_files',
    description:
      'Find files matching a glob pattern within a directory. ' +
      'Returns a list of matching file paths, one per line. ' +
      'Supports standard glob patterns: "*" matches any file, "**" matches directories recursively, "?" matches a single character. ' +
      'Example patterns: "**/*.ts" (all TypeScript files), "src/**/*.test.ts" (all test files in src).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search in' },
        pattern: { type: 'string', description: 'Glob pattern to match files against' },
      },
      required: ['path', 'pattern'],
    },
    async execute(input: unknown) {
      const { path, pattern } = input as { path: string; pattern: string }
      const glob = new Glob(pattern)
      const results: string[] = []
      for await (const file of glob.scan({ cwd: path, dot: false })) {
        results.push(file)
      }
      results.sort()
      return results.length ? results.join('\n') : `No files found matching "${pattern}"`
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/glob-files.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/glob-files.ts tests/tools/glob-files.test.ts
git commit -m "feat: add glob_files built-in tool"
```

---

### Task 9: Tool — `move_file`

**Files:**
- Create: `src/tools/move-file.ts`
- Test: `tests/tools/move-file.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { moveFileTool } from '../../src/tools/move-file'
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-move-file')

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('move_file', () => {
  it('moves a file', async () => {
    const tool = moveFileTool()
    const src = join(TMP, 'a.txt')
    const dst = join(TMP, 'b.txt')
    writeFileSync(src, 'content')
    await tool.execute({ source: src, destination: dst })
    expect(existsSync(src)).toBe(false)
    expect(readFileSync(dst, 'utf-8')).toBe('content')
  })

  it('creates parent directories for destination', async () => {
    const tool = moveFileTool()
    const src = join(TMP, 'a.txt')
    const dst = join(TMP, 'deep', 'nested', 'b.txt')
    writeFileSync(src, 'content')
    await tool.execute({ source: src, destination: dst })
    expect(readFileSync(dst, 'utf-8')).toBe('content')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/move-file.test.ts`

**Step 3: Implement**

```typescript
// src/tools/move-file.ts
import type { ITool } from '../providers/types'
import { rename, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function moveFileTool(): ITool {
  return {
    name: 'move_file',
    description:
      'Move or rename a file or directory from source to destination. ' +
      'Creates parent directories at the destination if they do not exist. ' +
      'Works on both files and directories.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Current path of the file or directory' },
        destination: { type: 'string', description: 'New path for the file or directory' },
      },
      required: ['source', 'destination'],
    },
    async execute(input: unknown) {
      const { source, destination } = input as { source: string; destination: string }
      await mkdir(dirname(destination), { recursive: true })
      await rename(source, destination)
      return `Moved: ${source} → ${destination}`
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/move-file.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/move-file.ts tests/tools/move-file.test.ts
git commit -m "feat: add move_file built-in tool"
```

---

### Task 10: Tool — `copy_file`

**Files:**
- Create: `src/tools/copy-file.ts`
- Test: `tests/tools/copy-file.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { copyFileTool } from '../../src/tools/copy-file'
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-copy-file')

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('copy_file', () => {
  it('copies a file', async () => {
    const tool = copyFileTool()
    const src = join(TMP, 'a.txt')
    const dst = join(TMP, 'b.txt')
    writeFileSync(src, 'content')
    await tool.execute({ source: src, destination: dst })
    expect(existsSync(src)).toBe(true) // source still exists
    expect(readFileSync(dst, 'utf-8')).toBe('content')
  })

  it('copies a directory recursively', async () => {
    const tool = copyFileTool()
    const srcDir = join(TMP, 'srcdir')
    mkdirSync(join(srcDir, 'nested'), { recursive: true })
    writeFileSync(join(srcDir, 'file.txt'), 'hello')
    writeFileSync(join(srcDir, 'nested', 'deep.txt'), 'deep')
    const dstDir = join(TMP, 'dstdir')
    await tool.execute({ source: srcDir, destination: dstDir })
    expect(readFileSync(join(dstDir, 'file.txt'), 'utf-8')).toBe('hello')
    expect(readFileSync(join(dstDir, 'nested', 'deep.txt'), 'utf-8')).toBe('deep')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/copy-file.test.ts`

**Step 3: Implement**

```typescript
// src/tools/copy-file.ts
import type { ITool } from '../providers/types'
import { cp, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function copyFileTool(): ITool {
  return {
    name: 'copy_file',
    description:
      'Copy a file or directory from source to destination. ' +
      'Directories are copied recursively, including all nested files and subdirectories. ' +
      'Creates parent directories at the destination if they do not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Path of the file or directory to copy' },
        destination: { type: 'string', description: 'Destination path for the copy' },
      },
      required: ['source', 'destination'],
    },
    async execute(input: unknown) {
      const { source, destination } = input as { source: string; destination: string }
      await mkdir(dirname(destination), { recursive: true })
      await cp(source, destination, { recursive: true })
      return `Copied: ${source} → ${destination}`
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/copy-file.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/copy-file.ts tests/tools/copy-file.test.ts
git commit -m "feat: add copy_file built-in tool"
```

---

### Task 11: Tool — `delete_file`

**Files:**
- Create: `src/tools/delete-file.ts`
- Test: `tests/tools/delete-file.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { deleteFileTool } from '../../src/tools/delete-file'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

const TMP = join(import.meta.dir, '.tmp-delete-file')

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('delete_file', () => {
  it('deletes a file', async () => {
    const tool = deleteFileTool()
    const p = join(TMP, 'a.txt')
    writeFileSync(p, 'content')
    await tool.execute({ path: p })
    expect(existsSync(p)).toBe(false)
  })

  it('deletes a directory recursively', async () => {
    const tool = deleteFileTool()
    const dir = join(TMP, 'subdir')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'file.txt'), 'content')
    await tool.execute({ path: dir })
    expect(existsSync(dir)).toBe(false)
  })

  it('throws on non-existent path', async () => {
    const tool = deleteFileTool()
    expect(tool.execute({ path: join(TMP, 'nope') })).rejects.toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/delete-file.test.ts`

**Step 3: Implement**

```typescript
// src/tools/delete-file.ts
import type { ITool } from '../providers/types'
import { rm, stat } from 'fs/promises'

export function deleteFileTool(): ITool {
  return {
    name: 'delete_file',
    description:
      'Delete a file or directory at the given path. ' +
      'Directories are deleted recursively, including all contents. ' +
      'This operation is irreversible — use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file or directory to delete' },
      },
      required: ['path'],
    },
    async execute(input: unknown) {
      const { path } = input as { path: string }
      // Verify it exists first (throws ENOENT if not)
      await stat(path)
      await rm(path, { recursive: true })
      return `Deleted: ${path}`
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/delete-file.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/delete-file.ts tests/tools/delete-file.test.ts
git commit -m "feat: add delete_file built-in tool"
```

---

### Task 12: Tool — `execute_bash` and `execute_powershell`

**Files:**
- Create: `src/tools/execute-bash.ts`
- Create: `src/tools/execute-powershell.ts`
- Test: `tests/tools/execute-command.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'bun:test'
import { executeBashTool } from '../../src/tools/execute-bash'
import { executePowershellTool } from '../../src/tools/execute-powershell'

describe('execute_bash', () => {
  it('has correct tool metadata', () => {
    const tool = executeBashTool()
    expect(tool.name).toBe('execute_bash')
    expect(tool.description).toContain('bash')
  })

  if (process.platform !== 'win32') {
    it('runs a command and returns output', async () => {
      const tool = executeBashTool()
      const result = await tool.execute({ command: 'echo hello' }) as string
      expect(result).toContain('hello')
    })

    it('returns stderr on failure', async () => {
      const tool = executeBashTool()
      const result = await tool.execute({ command: 'ls /nonexistent_path_xyz 2>&1; true' }) as string
      expect(result).toBeTruthy()
    })

    it('respects timeout', async () => {
      const tool = executeBashTool()
      expect(tool.execute({ command: 'sleep 60', timeout: 500 })).rejects.toThrow()
    })
  }
})

describe('execute_powershell', () => {
  it('has correct tool metadata', () => {
    const tool = executePowershellTool()
    expect(tool.name).toBe('execute_powershell')
    expect(tool.description).toContain('PowerShell')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/execute-command.test.ts`

**Step 3: Implement**

```typescript
// src/tools/execute-bash.ts
import type { ITool } from '../providers/types'
import { execFile } from 'child_process'

export function executeBashTool(): ITool {
  return {
    name: 'execute_bash',
    description:
      'Execute a bash command and return its output (stdout and stderr combined). ' +
      'The command runs in a bash shell on this system. Use standard bash syntax. ' +
      'Use the optional `timeout` parameter (in milliseconds) to limit execution time. Default timeout is 30 seconds. ' +
      'For long-running commands, consider running them in the background with "&" and redirecting output to a file. ' +
      'The `cwd` parameter sets the working directory for the command.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command. Optional.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds. Default: 30000. Optional.' },
      },
      required: ['command'],
    },
    async execute(input: unknown) {
      const { command, cwd, timeout = 30000 } = input as { command: string; cwd?: string; timeout?: number }
      return new Promise<string>((resolve, reject) => {
        execFile('bash', ['-c', command], { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error && error.killed) {
            reject(new Error(`Command timed out after ${timeout}ms`))
            return
          }
          const output = [stdout, stderr].filter(Boolean).join('\n').trim()
          resolve(output || (error ? `Exit code: ${error.code}` : '(no output)'))
        })
      })
    },
  }
}
```

```typescript
// src/tools/execute-powershell.ts
import type { ITool } from '../providers/types'
import { execFile } from 'child_process'

export function executePowershellTool(): ITool {
  return {
    name: 'execute_powershell',
    description:
      'Execute a PowerShell command and return its output. ' +
      'The command runs in PowerShell on this Windows system. Use PowerShell syntax. ' +
      'Examples: "Get-ChildItem" to list files, "Get-Content file.txt" to read a file, "Remove-Item file.txt" to delete. ' +
      'Use the optional `timeout` parameter (in milliseconds) to limit execution time. Default timeout is 30 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The PowerShell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command. Optional.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds. Default: 30000. Optional.' },
      },
      required: ['command'],
    },
    async execute(input: unknown) {
      const { command, cwd, timeout = 30000 } = input as { command: string; cwd?: string; timeout?: number }
      return new Promise<string>((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-Command', command], { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error && error.killed) {
            reject(new Error(`Command timed out after ${timeout}ms`))
            return
          }
          const output = [stdout, stderr].filter(Boolean).join('\n').trim()
          resolve(output || (error ? `Exit code: ${error.code}` : '(no output)'))
        })
      })
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/execute-command.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/execute-bash.ts src/tools/execute-powershell.ts tests/tools/execute-command.test.ts
git commit -m "feat: add execute_bash and execute_powershell built-in tools"
```

---

### Task 13: Tool — `web_fetch`

**Files:**
- Create: `src/tools/web-fetch.ts`
- Test: `tests/tools/web-fetch.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'bun:test'
import { webFetchTool } from '../../src/tools/web-fetch'

describe('web_fetch', () => {
  it('has correct tool metadata', () => {
    const tool = webFetchTool()
    expect(tool.name).toBe('web_fetch')
    expect(tool.inputSchema.required).toContain('url')
  })

  it('fetches a URL', async () => {
    // Use a simple echo endpoint
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    })
    try {
      const tool = webFetchTool()
      const result = await tool.execute({ url: `http://localhost:${server.port}/test` }) as string
      const parsed = JSON.parse(result)
      expect(parsed.status).toBe(200)
      expect(parsed.body).toContain('ok')
    } finally {
      server.stop(true)
    }
  })

  it('supports POST with body', async () => {
    let receivedBody = ''
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text()
        return new Response('ok')
      },
    })
    try {
      const tool = webFetchTool()
      await tool.execute({ url: `http://localhost:${server.port}`, method: 'POST', body: '{"key":"value"}' })
      expect(receivedBody).toBe('{"key":"value"}')
    } finally {
      server.stop(true)
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/web-fetch.test.ts`

**Step 3: Implement**

```typescript
// src/tools/web-fetch.ts
import type { ITool } from '../providers/types'

export function webFetchTool(): ITool {
  return {
    name: 'web_fetch',
    description:
      'Make an HTTP request to a URL and return the response. ' +
      'Returns a JSON object with `status` (HTTP status code), `headers` (response headers), and `body` (response body as text). ' +
      'Supports GET, POST, PUT, PATCH, DELETE methods. Default method is GET. ' +
      'Use `headers` to set request headers (e.g. Authorization, Content-Type). ' +
      'Use `body` to send a request body (for POST/PUT/PATCH).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        method: { type: 'string', description: 'HTTP method: GET, POST, PUT, PATCH, DELETE. Default: GET.' },
        headers: { type: 'object', description: 'Request headers as key-value pairs. Optional.' },
        body: { type: 'string', description: 'Request body string. Optional.' },
      },
      required: ['url'],
    },
    async execute(input: unknown) {
      const { url, method = 'GET', headers, body } = input as {
        url: string; method?: string; headers?: Record<string, string>; body?: string
      }
      const resp = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
      })
      const respBody = await resp.text()
      const respHeaders: Record<string, string> = {}
      resp.headers.forEach((v, k) => { respHeaders[k] = v })
      return JSON.stringify({ status: resp.status, headers: respHeaders, body: respBody })
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/web-fetch.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/web-fetch.ts tests/tools/web-fetch.test.ts
git commit -m "feat: add web_fetch built-in tool"
```

---

### Task 14: Tool — `ask_user`

**Files:**
- Create: `src/tools/ask-user.ts`
- Test: `tests/tools/ask-user.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'bun:test'
import { askUserTool, ASK_USER_SIGNAL } from '../../src/tools/ask-user'

describe('ask_user', () => {
  it('has correct tool metadata', () => {
    const tool = askUserTool()
    expect(tool.name).toBe('ask_user')
  })

  it('returns the question wrapped in signal', async () => {
    const tool = askUserTool()
    const result = await tool.execute({ question: 'What is your name?' })
    expect(result).toContain('What is your name?')
    expect(result).toContain(ASK_USER_SIGNAL)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/ask-user.test.ts`

**Step 3: Implement**

The tool returns a result containing a signal string that the loop/interface can detect to know it should suspend. The signal is a unique prefix in the tool result — the interfaces check for it after the loop ends.

```typescript
// src/tools/ask-user.ts
import type { ITool } from '../providers/types'

export const ASK_USER_SIGNAL = '__RA_ASK_USER__'

export function askUserTool(): ITool {
  return {
    name: 'ask_user',
    description:
      'Ask the user a question and wait for their response. ' +
      'Use this when you need clarification, confirmation, or additional information from the user before proceeding. ' +
      'The agent loop will pause after this tool is called. The user\'s response will come as a new message when they reply. ' +
      'Provide a clear, specific question.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
      },
      required: ['question'],
    },
    async execute(input: unknown) {
      const { question } = input as { question: string }
      return `${ASK_USER_SIGNAL}${question}`
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/ask-user.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/ask-user.ts tests/tools/ask-user.test.ts
git commit -m "feat: add ask_user built-in tool"
```

---

### Task 15: Tool — `checklist`

**Files:**
- Create: `src/tools/checklist.ts`
- Test: `tests/tools/checklist.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'bun:test'
import { checklistTool } from '../../src/tools/checklist'

describe('checklist', () => {
  it('creates a checklist', async () => {
    const tool = checklistTool()
    const result = await tool.execute({ action: 'create', title: 'My Tasks' }) as string
    expect(result).toContain('My Tasks')
  })

  it('adds items and lists them', async () => {
    const tool = checklistTool()
    await tool.execute({ action: 'create', title: 'Test' })
    await tool.execute({ action: 'add', title: 'Test', item: 'Task 1' })
    await tool.execute({ action: 'add', title: 'Test', item: 'Task 2' })
    const result = await tool.execute({ action: 'list', title: 'Test' }) as string
    expect(result).toContain('Task 1')
    expect(result).toContain('Task 2')
    expect(result).toContain('[ ]')
  })

  it('checks and unchecks items', async () => {
    const tool = checklistTool()
    await tool.execute({ action: 'create', title: 'Check' })
    await tool.execute({ action: 'add', title: 'Check', item: 'Do thing' })
    await tool.execute({ action: 'check', title: 'Check', index: 0 })
    let result = await tool.execute({ action: 'list', title: 'Check' }) as string
    expect(result).toContain('[x]')

    await tool.execute({ action: 'uncheck', title: 'Check', index: 0 })
    result = await tool.execute({ action: 'list', title: 'Check' }) as string
    expect(result).toContain('[ ]')
  })

  it('removes items', async () => {
    const tool = checklistTool()
    await tool.execute({ action: 'create', title: 'Remove' })
    await tool.execute({ action: 'add', title: 'Remove', item: 'A' })
    await tool.execute({ action: 'add', title: 'Remove', item: 'B' })
    await tool.execute({ action: 'remove', title: 'Remove', index: 0 })
    const result = await tool.execute({ action: 'list', title: 'Remove' }) as string
    expect(result).not.toContain('A')
    expect(result).toContain('B')
  })

  it('throws on unknown checklist', async () => {
    const tool = checklistTool()
    expect(tool.execute({ action: 'list', title: 'nonexistent' })).rejects.toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/checklist.test.ts`

**Step 3: Implement**

```typescript
// src/tools/checklist.ts
import type { ITool } from '../providers/types'

interface ChecklistItem {
  text: string
  checked: boolean
}

export function checklistTool(): ITool {
  const checklists = new Map<string, ChecklistItem[]>()

  return {
    name: 'checklist',
    description:
      'Manage a checklist for tracking tasks and progress. ' +
      'Actions: ' +
      '"create" — create a new checklist with a title. ' +
      '"add" — add an item to a checklist. ' +
      '"check" — mark an item as done (by index, 0-based). ' +
      '"uncheck" — mark an item as not done (by index, 0-based). ' +
      '"remove" — remove an item (by index, 0-based). ' +
      '"list" — show all items with their status. ' +
      'Checklists are identified by title and persist for the duration of the conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'add', 'check', 'uncheck', 'remove', 'list'], description: 'The action to perform' },
        title: { type: 'string', description: 'Title of the checklist' },
        item: { type: 'string', description: 'Item text (for "add" action)' },
        index: { type: 'number', description: 'Item index, 0-based (for "check", "uncheck", "remove" actions)' },
      },
      required: ['action', 'title'],
    },
    async execute(input: unknown) {
      const { action, title, item, index } = input as {
        action: string; title: string; item?: string; index?: number
      }

      if (action === 'create') {
        checklists.set(title, [])
        return `Checklist created: ${title}`
      }

      const list = checklists.get(title)
      if (!list) throw new Error(`Checklist not found: "${title}". Create it first with action "create".`)

      switch (action) {
        case 'add': {
          if (!item) throw new Error('Item text is required for "add" action')
          list.push({ text: item, checked: false })
          return `Added item ${list.length - 1}: ${item}`
        }
        case 'check': {
          if (index === undefined || index < 0 || index >= list.length) throw new Error(`Invalid index: ${index}`)
          list[index]!.checked = true
          return `Checked item ${index}: ${list[index]!.text}`
        }
        case 'uncheck': {
          if (index === undefined || index < 0 || index >= list.length) throw new Error(`Invalid index: ${index}`)
          list[index]!.checked = false
          return `Unchecked item ${index}: ${list[index]!.text}`
        }
        case 'remove': {
          if (index === undefined || index < 0 || index >= list.length) throw new Error(`Invalid index: ${index}`)
          const removed = list.splice(index, 1)[0]!
          return `Removed item: ${removed.text}`
        }
        case 'list': {
          if (list.length === 0) return `Checklist "${title}" is empty.`
          return `Checklist: ${title}\n` + list.map((item, i) => `${i}: ${item.checked ? '[x]' : '[ ]'} ${item.text}`).join('\n')
        }
        default:
          throw new Error(`Unknown action: ${action}`)
      }
    },
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/checklist.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/checklist.ts tests/tools/checklist.test.ts
git commit -m "feat: add checklist built-in tool"
```

---

### Task 16: Registration — `registerBuiltinTools()`

**Files:**
- Create: `src/tools/index.ts`
- Test: `tests/tools/index.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'bun:test'
import { registerBuiltinTools } from '../../src/tools'
import { ToolRegistry } from '../../src/agent/tool-registry'

describe('registerBuiltinTools', () => {
  it('registers all built-in tools', () => {
    const registry = new ToolRegistry()
    registerBuiltinTools(registry)
    const tools = registry.all()
    const names = tools.map(t => t.name)

    // Filesystem tools
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('update_file')
    expect(names).toContain('append_file')
    expect(names).toContain('list_directory')
    expect(names).toContain('search_files')
    expect(names).toContain('glob_files')
    expect(names).toContain('move_file')
    expect(names).toContain('copy_file')
    expect(names).toContain('delete_file')

    // Shell — platform-specific
    if (process.platform === 'win32') {
      expect(names).toContain('execute_powershell')
      expect(names).not.toContain('execute_bash')
    } else {
      expect(names).toContain('execute_bash')
      expect(names).not.toContain('execute_powershell')
    }

    // Network
    expect(names).toContain('web_fetch')

    // Agent interaction
    expect(names).toContain('ask_user')
    expect(names).toContain('checklist')
  })

  it('registers 13 tools (platform-specific shell)', () => {
    const registry = new ToolRegistry()
    registerBuiltinTools(registry)
    expect(registry.all()).toHaveLength(13)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/index.test.ts`

**Step 3: Implement**

```typescript
// src/tools/index.ts
import type { ToolRegistry } from '../agent/tool-registry'
import { readFileTool } from './read-file'
import { writeFileTool } from './write-file'
import { updateFileTool } from './update-file'
import { appendFileTool } from './append-file'
import { listDirectoryTool } from './list-directory'
import { searchFilesTool } from './search-files'
import { globFilesTool } from './glob-files'
import { moveFileTool } from './move-file'
import { copyFileTool } from './copy-file'
import { deleteFileTool } from './delete-file'
import { executeBashTool } from './execute-bash'
import { executePowershellTool } from './execute-powershell'
import { webFetchTool } from './web-fetch'
import { askUserTool } from './ask-user'
import { checklistTool } from './checklist'

export function registerBuiltinTools(registry: ToolRegistry): void {
  // Filesystem
  registry.register(readFileTool())
  registry.register(writeFileTool())
  registry.register(updateFileTool())
  registry.register(appendFileTool())
  registry.register(listDirectoryTool())
  registry.register(searchFilesTool())
  registry.register(globFilesTool())
  registry.register(moveFileTool())
  registry.register(copyFileTool())
  registry.register(deleteFileTool())

  // Shell — platform-specific
  if (process.platform === 'win32') {
    registry.register(executePowershellTool())
  } else {
    registry.register(executeBashTool())
  }

  // Network
  registry.register(webFetchTool())

  // Agent interaction
  registry.register(askUserTool())
  registry.register(checklistTool())
}
```

**Step 4: Run tests**

Run: `bun test tests/tools/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/index.ts tests/tools/index.test.ts
git commit -m "feat: add registerBuiltinTools function"
```

---

### Task 17: Wire into `src/index.ts`

**Files:**
- Modify: `src/index.ts:176-178` (add registration call after ToolRegistry creation)
- Modify: `src/index.ts:25-108` (update help text)

**Step 1: Add builtin tools registration**

In `src/index.ts`, after `const tools = new ToolRegistry()` (line 177), add:

```typescript
import { registerBuiltinTools } from './tools'

// After: const tools = new ToolRegistry()
if (config.builtinTools) {
  registerBuiltinTools(tools)
}
```

**Step 2: Update help text**

Add to the OPTIONS section in the HELP string:

```
  --builtin-tools                     Enable built-in tools (filesystem, shell, network)
```

Add to ENV VARS section:

```
  RA_BUILTIN_TOOLS
```

**Step 3: Run full test suite to verify nothing is broken**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire builtin tools registration into main entry point"
```

---

### Task 18: Handle `ask_user` suspension in interfaces

**Files:**
- Modify: `src/interfaces/cli.ts` (detect ask_user signal, print question + session_id)
- Modify: `src/interfaces/repl.ts` (detect ask_user signal, print question, auto-resume on next input)
- Modify: `src/interfaces/http.ts` (detect ask_user signal, return question + session_id in response)

**Step 1: Modify CLI**

In `src/interfaces/cli.ts`, after the loop completes, check the last tool message for the ask_user signal:

```typescript
import { ASK_USER_SIGNAL } from '../tools/ask-user'

// After loop.run() and saving messages, before the function returns:
const lastToolMsg = result.messages.findLast(m => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(ASK_USER_SIGNAL))
if (lastToolMsg && typeof lastToolMsg.content === 'string') {
  const question = lastToolMsg.content.slice(ASK_USER_SIGNAL.length)
  process.stderr.write(`\n[ask_user] ${question}\n`)
  process.stderr.write(`Resume with: ra --resume <session-id> "your answer"\n`)
}
```

**Step 2: Modify REPL**

In `src/interfaces/repl.ts`, in `processInput()`, after the loop completes and messages are saved, detect the signal:

```typescript
import { ASK_USER_SIGNAL } from '../tools/ask-user'

// After saving messages to storage:
const lastToolMsg = result.messages.findLast(m => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(ASK_USER_SIGNAL))
if (lastToolMsg && typeof lastToolMsg.content === 'string') {
  const question = lastToolMsg.content.slice(ASK_USER_SIGNAL.length)
  tui.printCommandResponse(`[Question for you] ${question}`)
}
```

The REPL naturally waits for the next input, so the user just types their answer and the loop runs again with history.

**Step 3: Modify HTTP**

In `src/interfaces/http.ts`, in the sync handler response and SSE stream, detect the signal:

```typescript
import { ASK_USER_SIGNAL } from '../tools/ask-user'

// In handleChatSync, before returning the response:
const askMsg = result.messages.findLast(m => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(ASK_USER_SIGNAL))
if (askMsg && typeof askMsg.content === 'string') {
  const question = askMsg.content.slice(ASK_USER_SIGNAL.length)
  return new Response(JSON.stringify({ response: responseText, askUser: question, sessionId: body.sessionId }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// In handleChatStream, before sending 'done':
const askMsg = result.messages.findLast(m => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(ASK_USER_SIGNAL))
if (askMsg && typeof askMsg.content === 'string') {
  send({ type: 'ask_user', question: askMsg.content.slice(ASK_USER_SIGNAL.length) })
}
```

**Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/interfaces/cli.ts src/interfaces/repl.ts src/interfaces/http.ts
git commit -m "feat: handle ask_user suspension in CLI, REPL, and HTTP interfaces"
```

---

### Task 19: Expose built-in tools via MCP server

**Files:**
- Modify: `src/mcp/server.ts` (register built-in tools as MCP tools when builtinTools is enabled)
- Modify: `src/index.ts` (pass tools registry or config to MCP server builder)

**Step 1: Update MCP server to accept tool registry**

In `src/mcp/server.ts`, modify `buildServer` to accept an optional `ToolRegistry` and register each tool as an MCP tool:

```typescript
import type { ToolRegistry } from '../agent/tool-registry'

function buildServer(config: McpServerConfig, handler: McpToolHandler, builtinTools?: ToolRegistry): McpServer {
  const server = new McpServer({ name: config.tool.name, version: '1.0.0' })

  // Register the main ra agent tool
  server.tool(
    config.tool.name,
    config.tool.description,
    { prompt: z.string().describe('The prompt to send to the agent') },
    async ({ prompt }) => ({
      content: [{ type: 'text' as const, text: await handler(prompt) }],
    })
  )

  // Expose built-in tools as MCP tools (except ask_user)
  if (builtinTools) {
    for (const tool of builtinTools.all()) {
      if (tool.name === 'ask_user') continue
      server.tool(
        tool.name,
        tool.description,
        tool.inputSchema as any,
        async (args: Record<string, unknown>) => ({
          content: [{ type: 'text' as const, text: String(await tool.execute(args)) }],
        })
      )
    }
  }

  return server
}
```

Update `startMcpStdio` and `startMcpHttp` signatures to accept the optional tools parameter and pass it through.

**Step 2: Update `src/index.ts`** to pass the tools registry to MCP server functions when `builtinTools` is enabled:

```typescript
// Where startMcpHttp/startMcpStdio are called, pass tools if builtinTools is on:
const mcpTools = config.builtinTools ? tools : undefined

// Replace each call like:
startMcpHttp(config.mcp.server, mcpHandler)
// With:
startMcpHttp(config.mcp.server, mcpHandler, mcpTools)
```

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/mcp/server.ts src/index.ts
git commit -m "feat: expose built-in tools via MCP server mode"
```

---

### Task 20: Update exports and type definitions

**Files:**
- Modify: `src/types.ts` (export ask_user signal and registerBuiltinTools)

**Step 1: Add exports**

In `src/types.ts`, add:

```typescript
// Built-in tools
export { registerBuiltinTools } from './tools/index.ts'
export { ASK_USER_SIGNAL } from './tools/ask-user.ts'
```

**Step 2: Run type check**

Run: `bun tsc`
Expected: No errors

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: export built-in tools API from package"
```

---

### Task 21: Final verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Run type check**

Run: `bun tsc`
Expected: No type errors

**Step 3: Manual smoke test**

Run: `bun run src/index.ts --builtin-tools "list the files in the current directory" --cli`
Expected: Agent uses `list_directory` or `execute_bash` tool and returns directory listing

**Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "feat: built-in tools - final cleanup"
```

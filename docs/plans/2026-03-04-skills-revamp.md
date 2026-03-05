# Skills System Revamp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Revamp the skills system to follow the Agent Skills spec — progressive disclosure with metadata-only XML injection for discovered skills, full body for always-on skills, no eager script execution, and GitHub tarball-based skill installation.

**Architecture:** Discovered skills (from `skillDirs`) inject `<available_skills>` XML with name/description/location as a user message. Always-on skills (from `config.skills`) inject full SKILL.md body wrapped in `<skill>` XML as a user message. Scripts are never run eagerly — the model reads and runs them on demand via filesystem tools. A new `ra skill install <github-url>` subcommand downloads tarballs and extracts the `skills/` directory.

**Tech Stack:** Bun, TypeScript, GitHub REST API (tarball endpoint)

---

### Task 1: Add `buildAvailableSkillsXml` and `buildActiveSkillXml` to loader

**Files:**
- Modify: `src/skills/loader.ts`
- Test: `tests/skills/loader.test.ts`

**Step 1: Write failing tests for XML generation**

Add to `tests/skills/loader.test.ts`:

```typescript
import { loadSkills, loadSkillMetadata, buildAvailableSkillsXml, buildActiveSkillXml } from '../../src/skills/loader'

describe('buildAvailableSkillsXml', () => {
  it('generates XML with name, description, and location for each skill', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const skills = await loadSkills([TEST_DIR])
    const xml = buildAvailableSkillsXml(skills)
    expect(xml).toContain('<available_skills>')
    expect(xml).toContain('<name>greet</name>')
    expect(xml).toContain('<description>Greets users warmly</description>')
    expect(xml).toContain(`<location>${TEST_DIR}/greet/SKILL.md</location>`)
    expect(xml).toContain('</available_skills>')
  })

  it('returns empty string for empty skill map', () => {
    const xml = buildAvailableSkillsXml(new Map())
    expect(xml).toBe('')
  })

  it('excludes skills listed in the exclude set', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets\n---\nBody')
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Reviews\n---\nBody')
    const skills = await loadSkills([TEST_DIR])
    const xml = buildAvailableSkillsXml(skills, new Set(['greet']))
    expect(xml).not.toContain('<name>greet</name>')
    expect(xml).toContain('<name>review</name>')
  })
})

describe('buildActiveSkillXml', () => {
  it('wraps skill body in skill XML tags', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const skills = await loadSkills([TEST_DIR])
    const xml = buildActiveSkillXml(skills.get('greet')!)
    expect(xml).toBe('<skill name="greet">\nHello! Greet the user.\n</skill>')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/skills/loader.test.ts`
Expected: FAIL — `buildAvailableSkillsXml` and `buildActiveSkillXml` not exported

**Step 3: Implement the functions**

Add to `src/skills/loader.ts`:

```typescript
import type { Skill } from './types'
import { join } from 'path'

export function buildAvailableSkillsXml(skills: Map<string, Skill>, exclude?: Set<string>): string {
  const entries: string[] = []
  for (const [name, skill] of skills) {
    if (exclude?.has(name)) continue
    entries.push(
      `  <skill>\n    <name>${name}</name>\n    <description>${skill.metadata.description}</description>\n    <location>${join(skill.dir, 'SKILL.md')}</location>\n  </skill>`
    )
  }
  if (entries.length === 0) return ''
  return `<available_skills>\n${entries.join('\n')}\n</available_skills>`
}

export function buildActiveSkillXml(skill: Skill): string {
  return `<skill name="${skill.metadata.name}">\n${skill.body}\n</skill>`
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/skills/loader.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/skills/loader.ts tests/skills/loader.test.ts
git commit -m "feat(skills): add XML generation for available and active skills"
```

---

### Task 2: Remove `buildSkillMessages` from runner

**Files:**
- Modify: `src/skills/runner.ts`
- Modify: `tests/skills/runner.test.ts`

**Step 1: Remove `buildSkillMessages` export from runner**

In `src/skills/runner.ts`, delete the `buildSkillMessages` function (lines 81-88) and remove the `Skill` type import and `IMessage` import.

Keep `runSkillScript` — it's still useful for the model to run scripts on demand.

**Step 2: Remove `buildSkillMessages` tests from runner test**

In `tests/skills/runner.test.ts`, delete the entire `describe('buildSkillMessages', ...)` block (lines 148-213). Remove the `buildSkillMessages` import.

**Step 3: Run tests to verify nothing is broken**

Run: `bun test tests/skills/runner.test.ts`
Expected: All remaining tests PASS

**Step 4: Commit**

```bash
git add src/skills/runner.ts tests/skills/runner.test.ts
git commit -m "refactor(skills): remove eager buildSkillMessages from runner"
```

---

### Task 3: Update CLI interface to use XML skill injection

**Files:**
- Modify: `src/interfaces/cli.ts`
- Modify: `tests/interfaces/cli.test.ts` (if exists, otherwise skip test update)

**Step 1: Update CLI to use XML-based skill injection**

Replace the current skill handling in `src/interfaces/cli.ts`:

```typescript
import { buildAvailableSkillsXml, buildActiveSkillXml } from '../skills/loader'

// Remove: import { buildSkillMessages } from '../skills/runner'
```

Replace the skills block (lines 38-43) with:

```typescript
  // Inject always-on skills as user messages with full body
  const activeSkillNames = new Set<string>()
  if (skills.length && skillMap) {
    for (const name of skills) {
      const skill = skillMap.get(name)
      if (skill) {
        initialMessages.push({ role: 'user', content: buildActiveSkillXml(skill) })
        activeSkillNames.add(name)
      }
    }
  }

  // Inject discovered (non-active) skills as available_skills XML
  if (skillMap && skillMap.size > activeSkillNames.size) {
    const xml = buildAvailableSkillsXml(skillMap, activeSkillNames)
    if (xml) initialMessages.push({ role: 'user', content: xml })
  }
```

**Step 2: Run tests**

Run: `bun test tests/interfaces/cli.test.ts`
Expected: PASS (or skip if no test file exists)

**Step 3: Run full test suite**

Run: `bun test`
Expected: No regressions

**Step 4: Commit**

```bash
git add src/interfaces/cli.ts
git commit -m "feat(cli): use XML skill injection instead of eager script execution"
```

---

### Task 4: Update REPL interface to use XML skill injection

**Files:**
- Modify: `src/interfaces/repl.ts`

**Step 1: Update REPL to inject available skills and use XML for /skill command**

In `src/interfaces/repl.ts`:

1. Add import: `import { buildAvailableSkillsXml, buildActiveSkillXml } from '../skills/loader'`

2. In `processInput`, update the skill injection (lines 82-85) to use `buildActiveSkillXml`:

```typescript
    const text = this.pendingSkill
      ? `${buildActiveSkillXml(this.pendingSkill)}\n\n${input}`
      : input
```

3. In `processInput`, after building `initialMessages` (after line 95), inject available skills XML if the skill map has skills that aren't already active:

```typescript
    // Inject available skills XML as first user message if skills exist
    if (this.options.skillMap && this.options.skillMap.size > 0 && this.messages.length === 0) {
      const xml = buildAvailableSkillsXml(this.options.skillMap)
      if (xml) {
        initialMessages.splice(
          this.options.systemPrompt ? 1 : 0,
          0,
          { role: 'user', content: xml }
        )
      }
    }
```

Note: Only inject on the first message of a session to avoid repeating in every turn.

**Step 2: Run tests**

Run: `bun test tests/interfaces/repl.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/interfaces/repl.ts
git commit -m "feat(repl): use XML skill injection for /skill and available skills"
```

---

### Task 5: Update HTTP interface to inject available skills

**Files:**
- Modify: `src/interfaces/http.ts`

**Step 1: Update HTTP to inject available skills XML**

In `src/interfaces/http.ts`:

1. Add import: `import { buildAvailableSkillsXml } from '../skills/loader'`

2. Update `prependSystem` to also prepend available skills:

```typescript
  private prependSystem(messages: IMessage[]): IMessage[] {
    const prefix: IMessage[] = []
    if (this.options.systemPrompt) {
      prefix.push({ role: 'system', content: this.options.systemPrompt })
    }
    if (this.options.skillMap && this.options.skillMap.size > 0) {
      const xml = buildAvailableSkillsXml(this.options.skillMap)
      if (xml) prefix.push({ role: 'user', content: xml })
    }
    return [...prefix, ...messages]
  }
```

**Step 2: Run tests**

Run: `bun test tests/interfaces/http.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/interfaces/http.ts
git commit -m "feat(http): inject available skills XML into conversations"
```

---

### Task 6: Implement `ra skill install` from GitHub tarball

**Files:**
- Create: `src/skills/install.ts`
- Test: `tests/skills/install.test.ts`
- Modify: `src/index.ts`
- Modify: `src/interfaces/parse-args.ts`

**Step 1: Write failing tests for skill installation**

Create `tests/skills/install.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { parseGithubUrl, extractSkillsFromTarball } from '../../src/skills/install'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from '../tmpdir'

const TEST_DIR = tmpdir('ra-test-install')

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('parseGithubUrl', () => {
  it('parses github.com/owner/repo', () => {
    const result = parseGithubUrl('github.com/anthropics/skills')
    expect(result).toEqual({ owner: 'anthropics', repo: 'skills', ref: undefined })
  })

  it('parses https://github.com/owner/repo', () => {
    const result = parseGithubUrl('https://github.com/anthropics/skills')
    expect(result).toEqual({ owner: 'anthropics', repo: 'skills', ref: undefined })
  })

  it('parses owner/repo shorthand', () => {
    const result = parseGithubUrl('anthropics/skills')
    expect(result).toEqual({ owner: 'anthropics', repo: 'skills', ref: undefined })
  })

  it('parses with ref/branch', () => {
    const result = parseGithubUrl('anthropics/skills@v2')
    expect(result).toEqual({ owner: 'anthropics', repo: 'skills', ref: 'v2' })
  })

  it('returns null for invalid URLs', () => {
    expect(parseGithubUrl('not-valid')).toBeNull()
    expect(parseGithubUrl('')).toBeNull()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/skills/install.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the install module**

Create `src/skills/install.ts`:

```typescript
import { join } from 'path'
import { mkdirSync, existsSync, cpSync } from 'fs'
import { loadSkills } from './loader'

export interface GithubRef {
  owner: string
  repo: string
  ref?: string
}

export function parseGithubUrl(input: string): GithubRef | null {
  // Strip protocol
  let cleaned = input.replace(/^https?:\/\//, '')
  // Strip github.com/ prefix if present
  cleaned = cleaned.replace(/^github\.com\//, '')
  // Now expect owner/repo or owner/repo@ref
  const match = cleaned.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:@(.+))?$/)
  if (!match) return null
  return { owner: match[1]!, repo: match[2]!, ref: match[3] }
}

export async function installSkillsFromGithub(
  input: string,
  targetDir: string,
): Promise<string[]> {
  const parsed = parseGithubUrl(input)
  if (!parsed) throw new Error(`Invalid GitHub URL: ${input}`)

  const { owner, repo, ref } = parsed
  const tarballUrl = ref
    ? `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`
    : `https://api.github.com/repos/${owner}/${repo}/tarball`

  // Download tarball
  const response = await fetch(tarballUrl, {
    headers: { 'Accept': 'application/vnd.github+json' },
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Failed to download from GitHub: ${response.status} ${response.statusText}`)
  }

  // Extract to temp directory
  const tmpDir = join(targetDir, '.tmp-install-' + Date.now())
  mkdirSync(tmpDir, { recursive: true })

  try {
    // Write tarball and extract
    const tarball = await response.arrayBuffer()
    const tarPath = join(tmpDir, 'repo.tar.gz')
    await Bun.write(tarPath, tarball)

    // Extract tarball
    const extract = Bun.spawnSync(['tar', 'xzf', tarPath, '-C', tmpDir])
    if (extract.exitCode !== 0) {
      throw new Error(`Failed to extract tarball: ${new TextDecoder().decode(extract.stderr)}`)
    }

    // Find the extracted directory (GitHub tarballs have a top-level dir like owner-repo-sha/)
    const entries = new Bun.Glob('*/').scanSync({ cwd: tmpDir, onlyFiles: false })
    let extractedDir: string | null = null
    for (const entry of entries) {
      if (entry !== '.tmp-install-') {
        extractedDir = join(tmpDir, entry)
        break
      }
    }
    if (!extractedDir) throw new Error('Could not find extracted directory in tarball')

    // Look for top-level skills/ directory
    const skillsDir = join(extractedDir, 'skills')
    if (!existsSync(skillsDir)) {
      throw new Error(`No skills/ directory found in ${owner}/${repo}`)
    }

    // Validate and copy each skill
    const skillMap = await loadSkills([skillsDir])
    const installed: string[] = []

    mkdirSync(targetDir, { recursive: true })
    for (const [name, skill] of skillMap) {
      const src = skill.dir
      const dest = join(targetDir, name)
      cpSync(src, dest, { recursive: true, force: true })
      installed.push(name)
    }

    return installed
  } finally {
    // Cleanup temp directory
    const { rmSync } = require('fs')
    rmSync(tmpDir, { recursive: true, force: true })
  }
}
```

**Step 4: Run tests to verify parsing tests pass**

Run: `bun test tests/skills/install.test.ts`
Expected: parseGithubUrl tests PASS

**Step 5: Commit**

```bash
git add src/skills/install.ts tests/skills/install.test.ts
git commit -m "feat(skills): add GitHub tarball-based skill installation"
```

---

### Task 7: Add `ra skill install` subcommand to CLI

**Files:**
- Modify: `src/index.ts`
- Modify: `src/interfaces/parse-args.ts`

**Step 1: Add subcommand detection to parse-args**

In `src/interfaces/parse-args.ts`, add to `ParsedArgsMeta`:

```typescript
export interface ParsedArgsMeta {
  help: boolean
  files: string[]
  skills: string[]
  prompt?: string
  resume?: string
  configPath?: string
  exec?: string
  subcommand?: { name: string; args: string[] }
}
```

In `parseArgs`, before the `utilParseArgs` call, detect the `skill` subcommand:

```typescript
  // Detect subcommands (e.g., "skill install github.com/org/repo")
  if (userArgs[0] === 'skill') {
    return {
      config: {} as Partial<RaConfig>,
      meta: {
        help: false,
        files: [],
        skills: [],
        subcommand: { name: 'skill', args: userArgs.slice(1) },
      },
    }
  }
```

**Step 2: Handle subcommand in main()**

In `src/index.ts`, after the `--help` check and before stdin reading, add:

```typescript
  if (parsed.meta.subcommand?.name === 'skill') {
    const { installSkillsFromGithub } = await import('./skills/install')
    const args = parsed.meta.subcommand.args
    if (args[0] === 'install' && args[1]) {
      const config = await loadConfig({ cwd: process.cwd(), env: process.env as Record<string, string | undefined> })
      const targetDir = config.skillDirs[0] || join(process.cwd(), 'skills')
      console.log(`Installing skills from ${args[1]} into ${targetDir}...`)
      const installed = await installSkillsFromGithub(args[1], targetDir)
      if (installed.length === 0) {
        console.log('No valid skills found.')
      } else {
        console.log(`Installed ${installed.length} skill(s): ${installed.join(', ')}`)
      }
    } else {
      console.log('Usage: ra skill install <github-url>')
    }
    process.exit(0)
  }
```

**Step 3: Update HELP text**

Add to the HELP string in `src/index.ts`:

```
SUBCOMMANDS
  skill install <github-url>          Install skills from a GitHub repository
                                      URL formats: owner/repo, github.com/owner/repo
                                      Optional ref: owner/repo@v2
```

**Step 4: Run tests**

Run: `bun test`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/index.ts src/interfaces/parse-args.ts
git commit -m "feat(skills): add 'ra skill install' subcommand for GitHub downloads"
```

---

### Task 8: Clean up unused imports and update index.ts skill wiring

**Files:**
- Modify: `src/index.ts`

**Step 1: Update skill injection in index.ts**

In `src/index.ts`, the `activeSkills` variable is computed but only passed to `runCli`. Verify that `cli.ts` and `repl.ts` now handle skill injection internally via the XML functions. The `skillMap` is already passed to all interfaces. The `activeSkills` list still needs to be passed so interfaces know which skills are always-on vs discovered.

Update the CLI call to pass `activeSkills` (already does this).

**Step 2: Remove unused buildSkillMessages import if present**

Check `src/index.ts` — it doesn't import `buildSkillMessages` directly (it's used in cli.ts). The cli.ts import was already updated in Task 3.

**Step 3: Run full test suite**

Run: `bun test`
Expected: All PASS

**Step 4: Run TypeScript type check**

Run: `bun tsc`
Expected: No errors

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "chore: clean up skill wiring in index.ts"
```

---

### Task 9: Update documentation

**Files:**
- Modify: `docs/site/skills/index.md`

**Step 1: Update skills documentation**

Update `docs/site/skills/index.md` to reflect:

1. **Progressive disclosure**: Discovered skills show as `<available_skills>` XML to the model. The model reads the full SKILL.md when it decides to activate.
2. **Always-on skills**: Skills named in config get their full body injected.
3. **Scripts are model-driven**: Scripts are not run eagerly. The model reads and executes them as needed.
4. **Installing from GitHub**: Document the `ra skill install` subcommand with URL formats.

**Step 2: Commit**

```bash
git add docs/site/skills/index.md
git commit -m "docs: update skills documentation for revamped system"
```

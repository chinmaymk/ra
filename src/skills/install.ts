import { join } from 'path'
import { mkdirSync, existsSync, cpSync, rmSync } from 'fs'
import { loadSkills } from './loader'

export interface GithubRef {
  owner: string
  repo: string
  ref?: string
}

export function parseGithubUrl(input: string): GithubRef | null {
  let cleaned = input.replace(/^https?:\/\//, '')
  cleaned = cleaned.replace(/^github\.com\//, '')
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

  const response = await fetch(tarballUrl, {
    headers: { 'Accept': 'application/vnd.github+json' },
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Failed to download from GitHub: ${response.status} ${response.statusText}`)
  }

  const tmpDir = join(targetDir, '.tmp-install-' + Date.now())
  mkdirSync(tmpDir, { recursive: true })

  try {
    const tarball = await response.arrayBuffer()
    const tarPath = join(tmpDir, 'repo.tar.gz')
    await Bun.write(tarPath, tarball)

    const extract = Bun.spawnSync(['tar', 'xzf', tarPath, '-C', tmpDir])
    if (extract.exitCode !== 0) {
      throw new Error(`Failed to extract tarball: ${new TextDecoder().decode(extract.stderr)}`)
    }

    // Find the extracted directory (GitHub tarballs have a top-level dir like owner-repo-sha/)
    let extractedDir: string | null = null
    for (const entry of new Bun.Glob('*/').scanSync({ cwd: tmpDir, onlyFiles: false })) {
      if (!entry.startsWith('.tmp-install-')) {
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
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

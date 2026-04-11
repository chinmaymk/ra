import { $ } from 'bun'
import { join } from 'path'
import { rm } from 'node:fs/promises'

export interface Worktree {
  path: string
  branch: string
}

export class WorktreeManager {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = join(baseDir, 'worktrees')
  }

  async create(sessionId: string, branch?: string): Promise<Worktree> {
    const wtPath = join(this.baseDir, sessionId)
    const branchName = branch ?? `ra/${sessionId.slice(0, 8)}`

    try {
      await $`git worktree add ${wtPath} -b ${branchName}`.quiet()
    } catch {
      // Branch may already exist
      await $`git worktree add ${wtPath} ${branchName}`.quiet()
    }

    return { path: wtPath, branch: branchName }
  }

  async remove(sessionId: string): Promise<void> {
    const wtPath = join(this.baseDir, sessionId)
    try {
      await $`git worktree remove ${wtPath} --force`.quiet()
    } catch {
      // Worktree may not exist; clean up directory manually
      await rm(wtPath, { recursive: true, force: true })
    }
    // Prune stale worktree refs
    await $`git worktree prune`.quiet().catch(() => {})
  }

  async list(): Promise<Worktree[]> {
    try {
      const result = await $`git worktree list --porcelain`.quiet()
      const lines = result.text().split('\n')
      const worktrees: Worktree[] = []
      let current: Partial<Worktree> = {}

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          current.path = line.slice(9)
        } else if (line.startsWith('branch ')) {
          current.branch = line.slice(7).replace('refs/heads/', '')
        } else if (line === '') {
          if (current.path?.startsWith(this.baseDir) && current.branch) {
            worktrees.push(current as Worktree)
          }
          current = {}
        }
      }
      return worktrees
    } catch {
      return []
    }
  }
}

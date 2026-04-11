import type { WebPanelDefinition, WebPanelRequestContext } from './types'

const MAX_DIFF_CHARS = 512 * 1024

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/**
 * Builtin panel: `git diff` in the session working directory (worktree or cwd).
 */
export const diffPanel: WebPanelDefinition = {
  id: 'diff',
  title: 'Diff',
  source: 'builtin',
  async handleRequest(req: Request, ctx: WebPanelRequestContext): Promise<Response | null> {
    if (req.method !== 'GET') return null
    const sp = ctx.subpath === '' ? '/' : ctx.subpath
    if (sp !== '/') return null

    const cwd = ctx.session.cwd
    ctx.logger.debug('web panel diff', { sessionId: ctx.session.id, cwd })

    const proc = Bun.spawn(['git', '-C', cwd, 'diff', '--no-color'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited

    if (code !== 0 && !stdout.trim()) {
      return json({
        cwd,
        text: '',
        gitError: stderr.trim() || `git diff exited with code ${code}`,
      })
    }

    let text = stdout
    let truncated = false
    if (text.length > MAX_DIFF_CHARS) {
      text = text.slice(0, MAX_DIFF_CHARS)
      truncated = true
    }

    return json({ cwd, text, truncated })
  },
}

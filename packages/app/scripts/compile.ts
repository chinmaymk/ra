#!/usr/bin/env bun
// Orchestrates `bun build --compile` for the ra binary:
//   1. build packages/web  (vite → packages/web/dist)
//   2. generate src/web/embedded-assets.generated.ts with static imports
//   3. bun build --compile (bundles + embeds the web assets)
//   4. restore the committed stub so the working tree stays clean
//
// Runs as `bun run compile` from packages/app.

import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

const APP_ROOT = join(import.meta.dir, '..')
const WEB_ROOT = join(APP_ROOT, '../web')
const RA_PKG_JSON = join(APP_ROOT, '../ra/package.json')
const EMBEDDED = join(APP_ROOT, 'src/web/embedded-assets.generated.ts')

async function sh(cmd: string, cwd: string): Promise<void> {
  const proc = Bun.spawn(['bash', '-c', cmd], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`"${cmd}" exited with ${code}`)
}

async function main(): Promise<void> {
  const stub = readFileSync(EMBEDDED, 'utf8')
  try {
    console.error('[compile] building packages/web…')
    await sh('bun run build', WEB_ROOT)

    console.error('[compile] generating embedded web asset manifest…')
    await sh('bun run scripts/embed-web.ts', APP_ROOT)

    const version = JSON.parse(readFileSync(RA_PKG_JSON, 'utf8')).version as string
    const commit = (await Bun.$`git rev-parse --short HEAD`.cwd(APP_ROOT).text()).trim()

    console.error('[compile] bun build --compile…')
    await sh(
      `bun build src/index.ts --compile --target bun --outfile dist/ra ` +
        `--define __RA_VERSION__='"${version}"' ` +
        `--define __RA_COMMIT__='"${commit}"'`,
      APP_ROOT,
    )
    console.error('[compile] done → packages/app/dist/ra')
  } finally {
    // Always restore the stub so `git status` stays clean regardless of
    // whether the compile succeeded.
    writeFileSync(EMBEDDED, stub)
  }
}

main().catch(err => {
  console.error('[compile] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})

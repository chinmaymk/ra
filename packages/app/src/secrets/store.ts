/**
 * Profile-aware secrets store at `~/.ra/secrets.json` (mode 0600).
 *
 * File shape:
 *   {
 *     "default":     { "OPENAI_API_KEY": "sk-...", ... },
 *     "work":        { "OPENAI_API_KEY": "sk-work-...", ... },
 *     "client-acme": { ... }
 *   }
 *
 * The file lives outside any project directory so it can never be
 * accidentally committed. Mode 0600 mirrors the existing pattern
 * established by `auth/codex.ts` for OAuth token persistence.
 *
 * Profile selection (resolved by callers, not here):
 *   --profile <name>  >  RA_PROFILE  >  "default"
 *
 * Real `process.env` values always take precedence over stored
 * secrets, so a one-shot `OPENAI_API_KEY=foo ra ...` invocation
 * works exactly as users expect, even if the profile has a
 * different value for that key.
 */

import { homedir } from 'os'
import { join, dirname } from 'path'
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'fs'

export const DEFAULT_PROFILE = 'default'

export type SecretsFile = Record<string, Record<string, string>>

/**
 * Resolve the secrets file path. Honors `RA_SECRETS_PATH` so tests
 * (and power users) can point at an alternate file without monkey
 * patching. Default is `~/.ra/secrets.json`.
 */
export function getSecretsPath(): string {
  return process.env.RA_SECRETS_PATH || join(homedir(), '.ra', 'secrets.json')
}

/** @deprecated use {@link getSecretsPath} — kept for tests that import it directly. */
export const SECRETS_PATH = join(homedir(), '.ra', 'secrets.json')

/** Synchronously read the secrets file. Returns an empty object if it doesn't exist. */
export function loadSecretsSync(path: string = getSecretsPath()): SecretsFile {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf-8')
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!isPlainObject(parsed)) return {}
    // Validate shape: top-level values must be plain objects of string→string
    const result: SecretsFile = {}
    for (const [profile, values] of Object.entries(parsed)) {
      if (!isPlainObject(values)) continue
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(values)) {
        if (typeof v === 'string') clean[k] = v
      }
      result[profile] = clean
    }
    return result
  } catch {
    return {}
  }
}

/** Atomically write the secrets file with mode 0600. */
export function saveSecrets(secrets: SecretsFile, path: string = getSecretsPath()): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(secrets, null, 2), { mode: 0o600 })
  // writeFileSync's mode arg only applies on creation; chmod ensures
  // existing files get tightened too.
  try { chmodSync(path, 0o600) } catch { /* best effort */ }
}

/** Get a single secret value from a profile. Returns undefined if missing. */
export function getSecret(name: string, profile: string = DEFAULT_PROFILE, path: string = getSecretsPath()): string | undefined {
  const all = loadSecretsSync(path)
  return all[profile]?.[name]
}

/** Set a secret value within a profile. Creates the profile if needed. */
export function setSecret(name: string, value: string, profile: string = DEFAULT_PROFILE, path: string = getSecretsPath()): void {
  const all = loadSecretsSync(path)
  const current = all[profile] ?? {}
  current[name] = value
  all[profile] = current
  saveSecrets(all, path)
}

/** Remove a secret. Returns true if it existed. */
export function removeSecret(name: string, profile: string = DEFAULT_PROFILE, path: string = getSecretsPath()): boolean {
  const all = loadSecretsSync(path)
  const current = all[profile]
  if (!current || !(name in current)) return false
  delete current[name]
  // Drop the whole profile entry if empty (keeps the file tidy).
  if (Object.keys(current).length === 0) delete all[profile]
  else all[profile] = current
  saveSecrets(all, path)
  return true
}

/** List the names of all profiles present in the secrets file. */
export function listProfiles(path: string = getSecretsPath()): string[] {
  return Object.keys(loadSecretsSync(path)).sort()
}

/** Get all secrets for a profile (empty object if missing). */
export function getProfileSecrets(profile: string = DEFAULT_PROFILE, path: string = getSecretsPath()): Record<string, string> {
  const all = loadSecretsSync(path)
  return all[profile] ?? {}
}

/**
 * Build a merged env where stored secrets fill in for missing
 * `process.env` entries, but never override existing ones. This is
 * the input to yargs option defaults, so the precedence becomes:
 *
 *   process.env > secrets[profile] > undefined
 *
 * Yargs CLI flags then layer on top of this when resolved.
 */
export function buildMergedEnv(
  profile: string,
  realEnv: Record<string, string | undefined> = process.env,
  path: string = getSecretsPath(),
): Record<string, string | undefined> {
  const stored = getProfileSecrets(profile, path)
  return { ...stored, ...realEnv }
}

/** Mask a secret value for display: show first 3 + last 4 chars, dots between. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 3)}…${value.slice(-4)}`
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

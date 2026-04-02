/**
 * Codex OAuth — device-code flow for ChatGPT subscription access.
 *
 * Authenticates via OpenAI's OAuth endpoints and persists tokens
 * to ~/.ra/codex-tokens.json for reuse across sessions.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ── OAuth constants ─────────────────────────────────────────────────

const AUTH0_CLIENT_ID = 'DRivsnm2Mu42T3KOpqdtwB3NYviHYzwD'
const AUTH0_DOMAIN = 'https://auth0.openai.com'
const DEVICE_CODE_URL = `${AUTH0_DOMAIN}/oauth/device/code`
const TOKEN_URL = `${AUTH0_DOMAIN}/oauth/token`
const AUDIENCE = 'https://api.openai.com/v1'
const SCOPE = 'openid profile email offline_access'

const TOKENS_DIR = join(homedir(), '.ra')
const TOKENS_PATH = join(TOKENS_DIR, 'codex-tokens.json')

// ── Types ───────────────────────────────────────────────────────────

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type: string
  expires_in: number
}

interface StoredTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number // unix ms
}

// ── Token persistence ───────────────────────────────────────────────

export async function loadStoredTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await readFile(TOKENS_PATH, 'utf-8')
    return JSON.parse(raw) as StoredTokens
  } catch {
    return null
  }
}

async function saveTokens(tokens: StoredTokens): Promise<void> {
  await mkdir(TOKENS_DIR, { recursive: true })
  await writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 })
}

// ── Token refresh ───────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<StoredTokens | null> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: AUTH0_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) return null

  const data = (await res.json()) as TokenResponse
  const tokens: StoredTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  await saveTokens(tokens)
  return tokens
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get a valid access token, refreshing if needed.
 * Returns null if no stored tokens or refresh fails.
 */
export async function getCodexAccessToken(): Promise<string | null> {
  const stored = await loadStoredTokens()
  if (!stored) return null

  // Still valid (with 60s buffer)
  if (stored.expiresAt > Date.now() + 60_000) {
    return stored.accessToken
  }

  // Try refresh
  if (stored.refreshToken) {
    const refreshed = await refreshAccessToken(stored.refreshToken)
    if (refreshed) return refreshed.accessToken
  }

  return null
}

/**
 * Run the device-code OAuth login flow.
 * Prints a URL for the user to visit, then polls until authorized.
 */
export async function loginCodex(): Promise<StoredTokens> {
  // Step 1: Request device code
  const codeRes = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: AUTH0_CLIENT_ID,
      audience: AUDIENCE,
      scope: SCOPE,
    }),
  })
  if (!codeRes.ok) {
    const text = await codeRes.text()
    throw new Error(`Failed to request device code: ${codeRes.status} ${text}`)
  }

  const deviceCode = (await codeRes.json()) as DeviceCodeResponse

  // Step 2: Show user the verification URL
  console.log()
  console.log('  Open this URL in your browser:')
  console.log()
  console.log(`    ${deviceCode.verification_uri_complete}`)
  console.log()
  console.log(`  Or go to ${deviceCode.verification_uri} and enter code: ${deviceCode.user_code}`)
  console.log()
  console.log('  Waiting for authorization...')

  // Step 3: Poll for token
  const interval = Math.max(deviceCode.interval, 5) * 1000
  const deadline = Date.now() + deviceCode.expires_in * 1000

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, interval))

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: AUTH0_CLIENT_ID,
        device_code: deviceCode.device_code,
      }),
    })

    const body = (await tokenRes.json()) as TokenResponse & { error?: string }

    if (body.error === 'authorization_pending') continue
    if (body.error === 'slow_down') {
      await new Promise(resolve => setTimeout(resolve, 5000))
      continue
    }
    if (body.error) {
      throw new Error(`OAuth error: ${body.error}`)
    }

    // Success
    const tokens: StoredTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    }
    await saveTokens(tokens)
    console.log('  Login successful! Token saved to', TOKENS_PATH)
    return tokens
  }

  throw new Error('Device code expired. Please try again.')
}

/**
 * Codex OAuth — device-code flow for ChatGPT subscription access.
 *
 * Authenticates via OpenAI's auth endpoints and persists tokens
 * to ~/.ra/codex-tokens.json for reuse across sessions.
 *
 * Flow reference: https://github.com/tumf/opencode-openai-device-auth
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ── OAuth constants ─────────────────────────────────────────────────

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH_BASE = 'https://auth.openai.com'
const DEVICE_CODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`
const REFRESH_TOKEN_URL = `${AUTH_BASE}/oauth/token`
const VERIFICATION_URL = `${AUTH_BASE}/codex/device`

const TOKENS_DIR = join(homedir(), '.ra')
const TOKENS_PATH = join(TOKENS_DIR, 'codex-tokens.json')

// ── Types ───────────────────────────────────────────────────────────

interface DeviceCodeResponse {
  user_code: string
  device_code: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
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
  const res = await fetch(REFRESH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
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
    body: JSON.stringify({ client_id: CLIENT_ID }),
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
  console.log(`    ${VERIFICATION_URL}`)
  console.log()
  console.log(`  Enter code: ${deviceCode.user_code}`)
  console.log()
  console.log('  Waiting for authorization...')

  // Step 3: Poll for token
  const interval = Math.max(deviceCode.interval, 5) * 1000
  const deadline = Date.now() + deviceCode.expires_in * 1000

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, interval))

    const tokenRes = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode.device_code,
        grant_type: 'authorization_code',
      }),
    })

    if (tokenRes.status === 428 || tokenRes.status === 400) {
      // Authorization pending — user hasn't completed login yet
      continue
    }

    const body = (await tokenRes.json()) as TokenResponse & { error?: string }

    if (body.error === 'authorization_pending' || body.error === 'slow_down') {
      if (body.error === 'slow_down') {
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
      continue
    }
    if (body.error) {
      throw new Error(`OAuth error: ${body.error}`)
    }

    if (!body.access_token) continue

    // Success
    const tokens: StoredTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + (body.expires_in || 3600) * 1000,
    }
    await saveTokens(tokens)
    console.log('  Login successful! Token saved to', TOKENS_PATH)
    return tokens
  }

  throw new Error('Device code expired. Please try again.')
}

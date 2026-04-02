/**
 * Codex OAuth — authenticate with a ChatGPT subscription.
 *
 * Two flows:
 *   1. PKCE (primary) — opens browser, local callback server on :1455
 *   2. Device Code (headless fallback) — two-phase: poll for auth code,
 *      then exchange at /oauth/token
 *
 * Tokens persisted to ~/.ra/codex-tokens.json.
 *
 * References:
 *   - https://github.com/anomalyco/opencode/issues/3281
 *   - https://github.com/tumf/opencode-openai-device-auth
 *   - https://github.com/EvanZhouDev/openai-oauth
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ── OAuth constants ─────────────────────────────────────────────────

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH_BASE = 'https://auth.openai.com'
const AUTHORIZE_URL = `${AUTH_BASE}/oauth/authorize`
const TOKEN_URL = `${AUTH_BASE}/oauth/token`
const DEVICE_CODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`
const VERIFICATION_URL = `${AUTH_BASE}/codex/device`
const REDIRECT_PORT = 1455
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`
const SCOPES = 'openid profile email offline_access'

const TOKENS_DIR = join(homedir(), '.ra')
const TOKENS_PATH = join(TOKENS_DIR, 'codex-tokens.json')

// ── Types ───────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
  error?: string
  error_description?: string
}

/** Response from POST /api/accounts/deviceauth/usercode */
interface DeviceUserCodeResponse {
  device_auth_id: string
  user_code: string
  expires_in: number
  interval: number
}

/** Response from POST /api/accounts/deviceauth/token (phase 1 poll) */
interface DeviceAuthCodeResponse {
  authorization_code: string
  code_verifier: string
  code_challenge: string
}

interface StoredTokens {
  accessToken: string
  refreshToken?: string
  deviceId: string
  expiresAt: number // unix ms
}

// ── Helpers ─────────────────────────────────────────────────────────

function toStoredTokens(data: TokenResponse, prev?: StoredTokens): StoredTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? prev?.refreshToken,
    deviceId: prev?.deviceId ?? randomUUID(),
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  }
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

async function refreshAccessToken(stored: StoredTokens): Promise<StoredTokens | null> {
  if (!stored.refreshToken) return null
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: stored.refreshToken,
    }),
  })
  if (!res.ok) return null

  const data = (await res.json()) as TokenResponse
  if (!data.access_token) return null
  const tokens = toStoredTokens(data, stored)
  await saveTokens(tokens)
  return tokens
}

/** Exchange an authorization code for tokens at /oauth/token. */
async function exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<StoredTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as TokenResponse
  if (data.error) throw new Error(`OAuth error: ${data.error} — ${data.error_description ?? ''}`)

  const tokens = toStoredTokens(data)
  await saveTokens(tokens)
  return tokens
}

// ── Public API ──────────────────────────────────────────────────────

/** Get a valid access token, refreshing if needed. */
export async function getCodexAccessToken(): Promise<string | null> {
  const stored = await loadStoredTokens()
  if (!stored) return null

  if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken

  const refreshed = await refreshAccessToken(stored)
  return refreshed?.accessToken ?? null
}

/** Get the persisted device ID (for the provider's oai-device-id header). */
export async function getCodexDeviceId(): Promise<string | undefined> {
  const stored = await loadStoredTokens()
  return stored?.deviceId
}

/** Login via PKCE flow — opens browser, local callback server on :1455. */
export async function loginCodexPkce(): Promise<StoredTokens> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  const authorizeUrl = `${AUTHORIZE_URL}?${params}`

  const code = await waitForCallback(state, authorizeUrl)
  const tokens = await exchangeCode(code, verifier, REDIRECT_URI)
  console.log('  Login successful! Token saved to', TOKENS_PATH)
  return tokens
}

/** Spin up a local HTTP server on :1455 and wait for the OAuth redirect. */
function waitForCallback(expectedState: string, authorizeUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn: typeof resolve | typeof reject, value: string | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      ;(fn as (v: string | Error) => void)(value)
    }

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`)
      if (!url.pathname.startsWith('/auth/callback')) {
        res.writeHead(404).end('Not found')
        return
      }

      const error = url.searchParams.get('error')
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h2>Login failed</h2><p>You can close this window.</p>')
        settle(reject, new Error(`OAuth callback error: ${error}`))
        return
      }

      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end('<h2>Invalid callback</h2>')
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h2>Login successful!</h2><p>You can close this window.</p>')
      settle(resolve, code)
    })

    server.listen(REDIRECT_PORT, () => {
      console.log()
      console.log('  Open this URL in your browser:')
      console.log()
      console.log(`    ${authorizeUrl}`)
      console.log()
      console.log('  Waiting for authorization...')
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        settle(reject, new Error(`Port ${REDIRECT_PORT} is in use. Close the process using it, or use --device-code.`))
      } else {
        settle(reject, err as Error)
      }
    })

    const timer = setTimeout(() => settle(reject, new Error('Login timed out after 5 minutes.')), 5 * 60 * 1000)
  })
}

/**
 * Login via device code flow — for headless/SSH environments.
 *
 * Two-phase flow:
 *   Phase 1: Poll /deviceauth/token with device_auth_id until user authorizes.
 *            Returns an authorization_code + code_verifier.
 *   Phase 2: Exchange the code at /oauth/token (same as PKCE exchange).
 */
export async function loginCodexDeviceCode(): Promise<StoredTokens> {
  // Phase 1a: Request device auth ID and user code
  const codeRes = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })
  if (!codeRes.ok) {
    const text = await codeRes.text()
    throw new Error(`Failed to request device code: ${codeRes.status} ${text}`)
  }

  const device = (await codeRes.json()) as DeviceUserCodeResponse

  console.log()
  console.log('  Open this URL in your browser:')
  console.log()
  console.log(`    ${VERIFICATION_URL}`)
  console.log()
  console.log(`  Enter code: ${device.user_code}`)
  console.log()
  console.log('  Waiting for authorization...')

  // Phase 1b: Poll for authorization code
  const interval = Math.max(device.interval, 5) * 1000
  const deadline = Date.now() + device.expires_in * 1000

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, interval))

    const pollRes = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: device.device_auth_id,
        user_code: device.user_code,
      }),
    })

    // 403/404 = authorization pending (user hasn't entered code yet)
    if (pollRes.status === 403 || pollRes.status === 404) continue

    if (!pollRes.ok) {
      const text = await pollRes.text()
      throw new Error(`Device auth poll failed: ${pollRes.status} ${text}`)
    }

    const authCode = (await pollRes.json()) as DeviceAuthCodeResponse
    if (!authCode.authorization_code) continue

    // Phase 2: Exchange authorization code for tokens
    const tokens = await exchangeCode(authCode.authorization_code, authCode.code_verifier, DEVICE_REDIRECT_URI)
    console.log('  Login successful! Token saved to', TOKENS_PATH)
    return tokens
  }

  throw new Error('Device code expired. Please try again.')
}

/** Login entry point. Use `--device-code` flag for headless environments. */
export async function loginCodex(opts?: { deviceCode?: boolean }): Promise<StoredTokens> {
  if (opts?.deviceCode) return loginCodexDeviceCode()
  return loginCodexPkce()
}

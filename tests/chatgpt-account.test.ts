/**
 * «Sign in with ChatGPT» contra un servidor OIDC simulado: PKCE, state, registro dinámico,
 * validación del ID token, rotación del refresh token y revocación.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildAuthorizeUrl,
  ChatGPTAccount,
  pkceChallenge,
  type SecretBox
} from '../src/main/accounts/chatgpt'
import { AppErrorException } from '../src/shared/errors'

const ISSUED_CLIENT = 'oaiapp_test123'
const FULL_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'

let server: Server
let base: string
let privateKey: KeyObject
let publicJwk: Record<string, unknown>
let dir: string

/** Estado del servidor simulado, reiniciado en cada test. */
let mock: {
  nonce: string
  scope: string
  expiresIn: number
  tokenRequests: URLSearchParams[]
  revoked: URLSearchParams[]
  refreshError: string | null
  idTokenNonce: string | null
  refreshCount: number
}

const secrets: SecretBox = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: (stored) => Buffer.from(stored.replace(/^enc:/, ''), 'base64').toString('utf8')
}

function idToken(nonce: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: base,
      aud: ISSUED_CLIENT,
      sub: 'user-1',
      email: 'ana@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce
    })
  ).toString('base64url')
  const sig = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey)
  return `${header}.${payload}.${sig.toString('base64url')}`
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

beforeAll(async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  privateKey = pair.privateKey
  publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }

  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base)
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(res, 200, {
        issuer: base,
        jwks_uri: `${base}/jwks`,
        revocation_endpoint: `${base}/revoke`
      })
    }
    if (url.pathname === '/jwks') return json(res, 200, { keys: [publicJwk] })
    if (url.pathname === '/revoke') {
      mock.revoked.push(new URLSearchParams(await readBody(req)))
      return res.writeHead(200).end()
    }
    if (url.pathname === '/models') {
      return json(res, 200, {
        models: [
          { slug: 'gpt-plan', display_name: 'GPT Plan', visibility: 'list' },
          { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide' }
        ]
      })
    }
    if (url.pathname === '/api/accounts/oauth/token') {
      const params = new URLSearchParams(await readBody(req))
      mock.tokenRequests.push(params)
      if (params.get('grant_type') === 'refresh_token') {
        if (mock.refreshError) return json(res, 400, { error: mock.refreshError })
        mock.refreshCount++
        return json(res, 200, {
          access_token: `access-${mock.refreshCount + 1}`,
          refresh_token: `refresh-${mock.refreshCount + 1}`,
          expires_in: 3600,
          scope: FULL_SCOPE
        })
      }
      return json(res, 200, {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        id_token: idToken(mock.idTokenNonce ?? mock.nonce),
        expires_in: mock.expiresIn,
        scope: mock.scope
      })
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

beforeEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = await mkdtemp(join(tmpdir(), 'notetaker-chatgpt-'))
  mock = {
    nonce: '',
    scope: FULL_SCOPE,
    expiresIn: 3600,
    tokenRequests: [],
    revoked: [],
    refreshError: null,
    idTokenNonce: null,
    refreshCount: 0
  }
})

/**
 * Simula al navegador: valida la URL de autorización y llama al callback de la app.
 * `override` permite alterar los parámetros del callback (otro state, un error…).
 */
function browser(
  override: Record<string, string> = {},
  seen: { url?: URL } = {}
): (url: string) => Promise<void> {
  return async (raw) => {
    const url = new URL(raw)
    seen.url = url
    const q = url.searchParams
    mock.nonce = q.get('nonce')!
    const callback = new URL(q.get('redirect_uri')!)
    callback.searchParams.set('code', 'auth-code')
    callback.searchParams.set('state', q.get('state')!)
    callback.searchParams.set('client_id', ISSUED_CLIENT)
    for (const [k, v] of Object.entries(override)) callback.searchParams.set(k, v)
    // Como un navegador: la petición sale después de que openExternal resuelva.
    setTimeout(() => void fetch(callback), 0)
  }
}

function account(openBrowser: (url: string) => Promise<void>): ChatGPTAccount {
  return new ChatGPTAccount({
    dir,
    secrets,
    openBrowser,
    endpoints: { issuer: base, apiBase: base }
  })
}

describe('PKCE and authorize URL', () => {
  it('computes the S256 challenge from RFC 7636', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('uses dynamic registration only on the first sign-in', () => {
    const common = {
      hostId: 'urn:uuid:1',
      redirectUri: 'http://127.0.0.1:5555/auth/callback',
      state: 's',
      nonce: 'n',
      challenge: 'c'
    }
    const first = new URL(buildAuthorizeUrl(base, { ...common, clientId: null })).searchParams
    expect(first.get('client_id')).toBe('dynamic_agent_client')
    expect(first.get('agent_name_hint')).toBe('NoteTaker')
    expect(first.get('scope')).toBe(FULL_SCOPE)
    expect(first.get('resource')).toBe('https://api.openai.com/v1')
    expect(first.get('code_challenge_method')).toBe('S256')
    expect(first.get('ext_agent_host_id')).toBe('urn:uuid:1')

    const again = new URL(buildAuthorizeUrl(base, { ...common, clientId: ISSUED_CLIENT }))
      .searchParams
    expect(again.get('client_id')).toBe(ISSUED_CLIENT)
    expect(again.has('agent_name_hint')).toBe(false)
  })
})

describe('ChatGPTAccount.signIn', () => {
  it('completes the flow, verifies the ID token and stores encrypted tokens', async () => {
    const seen: { url?: URL } = {}
    const acc = account(browser({}, seen))
    const info = await acc.signIn()
    expect(info).toEqual({ email: 'ana@example.com' })

    const redirect = new URL(seen.url!.searchParams.get('redirect_uri')!)
    expect(redirect.hostname).toBe('127.0.0.1')
    expect(redirect.pathname).toBe('/auth/callback')

    const exchange = mock.tokenRequests[0]
    expect(exchange.get('grant_type')).toBe('authorization_code')
    expect(exchange.get('client_id')).toBe(ISSUED_CLIENT)
    expect(exchange.get('redirect_uri')).toBe(redirect.toString())
    expect(pkceChallenge(exchange.get('code_verifier')!)).toBe(
      seen.url!.searchParams.get('code_challenge')
    )

    const stored = JSON.parse(await readFile(join(dir, 'chatgpt-auth.json'), 'utf8'))
    expect(stored.clientId).toBe(ISSUED_CLIENT)
    expect(stored.session).toMatch(/^enc:/)
    expect(JSON.stringify(stored)).not.toContain('access-1')

    // Otra instancia (reinicio de la app) recupera la sesión.
    expect(account(browser()).info()).toEqual({ email: 'ana@example.com' })
    expect(await account(browser()).getAccessToken()).toBe('access-1')
  })

  it('rejects a callback with a different state', async () => {
    const err = await account(browser({ state: 'forged' }))
      .signIn()
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppErrorException)
    expect(err.code).toBe('SIGN_IN_FAILED')
    expect(mock.tokenRequests).toHaveLength(0)
  })

  it('treats access_denied as not eligible and does not exchange the code', async () => {
    const err = await account(browser({ error: 'access_denied' }))
      .signIn()
      .catch((e) => e)
    expect(err.code).toBe('ACCOUNT_NOT_ELIGIBLE')
    expect(mock.tokenRequests).toHaveLength(0)
  })

  it('requires the plan usage scope', async () => {
    mock.scope = 'openid profile email offline_access'
    const acc = account(browser())
    const err = await acc.signIn().catch((e) => e)
    expect(err.code).toBe('ACCOUNT_NOT_ELIGIBLE')
    expect(acc.info()).toBeNull()
  })

  it('rejects an ID token with another nonce', async () => {
    mock.idTokenNonce = 'replayed'
    const err = await account(browser())
      .signIn()
      .catch((e) => e)
    expect(err.code).toBe('SIGN_IN_FAILED')
  })

  it('can be cancelled while waiting for the browser', async () => {
    const acc = account(async () => {
      setTimeout(() => acc.cancelSignIn(), 0)
    })
    const err = await acc.signIn().catch((e) => e)
    expect(err.code).toBe('CANCELLED')
  })
})

describe('ChatGPTAccount tokens', () => {
  it('refreshes once for concurrent callers and keeps the rotated refresh token', async () => {
    mock.expiresIn = 30 // dentro del margen de refresco
    const acc = account(browser())
    await acc.signIn()

    const [a, b] = await Promise.all([acc.getAccessToken(), acc.getAccessToken()])
    expect(a).toBe('access-2')
    expect(b).toBe('access-2')
    const refreshes = mock.tokenRequests.filter((p) => p.get('grant_type') === 'refresh_token')
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0].get('refresh_token')).toBe('refresh-1')
    expect(refreshes[0].get('client_id')).toBe(ISSUED_CLIENT)

    // Tras reiniciar, el refresh token guardado es el rotado.
    const stored = JSON.parse(await readFile(join(dir, 'chatgpt-auth.json'), 'utf8'))
    expect(secrets.decrypt(stored.session)).toContain('refresh-2')
  })

  it('clears the session when the refresh token is no longer valid', async () => {
    mock.expiresIn = 30
    const acc = account(browser())
    await acc.signIn()
    mock.refreshError = 'invalid_grant'
    const err = await acc.getAccessToken().catch((e) => e)
    expect(err.code).toBe('ACCOUNT_SIGNED_OUT')
    expect(acc.info()).toBeNull()
  })

  it('revokes the refresh token on sign-out', async () => {
    const acc = account(browser())
    await acc.signIn()
    await acc.signOut()
    expect(acc.info()).toBeNull()
    expect(mock.revoked[0].get('token')).toBe('refresh-1')
    expect(mock.revoked[0].get('token_type_hint')).toBe('refresh_token')
    expect(mock.revoked[0].get('client_id')).toBe(ISSUED_CLIENT)
    await expect(acc.getAccessToken()).rejects.toMatchObject({ code: 'ACCOUNT_SIGNED_OUT' })
  })

  it('lists only the models meant to be shown', async () => {
    const acc = account(browser())
    await acc.signIn()
    expect(await acc.listModels()).toEqual([{ slug: 'gpt-plan', displayName: 'GPT Plan' }])
  })
})

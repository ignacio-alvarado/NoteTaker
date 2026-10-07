import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
  type JsonWebKey
} from 'crypto'
import { readFileSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'
import { AppErrorException } from '@shared/errors'
import type { ChatGPTAccountInfo } from '@shared/types'

/**
 * «Sign in with ChatGPT» con uso del plan (scope `chatgpt.tokens.use.direct`): OAuth 2.0 con
 * PKCE y callback en loopback, registro dinámico del cliente y refresco con rotación.
 * Ver https://developers.openai.com/siwc/token-sharing-open-source
 */

export const CHATGPT_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = `openid profile email offline_access resource.invoke ${CHATGPT_SCOPE}`
const DYNAMIC_CLIENT = 'dynamic_agent_client'
const AGENT_NAME = 'NoteTaker'
/** El path es fijo desde el primer registro; solo puede cambiar el puerto. */
const CALLBACK_PATH = '/auth/callback'
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
/** Se refresca el access token si caduca en menos de esto. */
const REFRESH_MARGIN_MS = 2 * 60_000
/** Errores de refresco que invalidan la sesión: hay que volver a conectar. */
const DEAD_REFRESH = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_reused'
])

export interface ChatGPTEndpoints {
  /** Emisor OIDC; también es la base de authorize/token. */
  issuer: string
  /** Base de la Responses API y del listado de modelos. */
  apiBase: string
}

export const DEFAULT_CHATGPT_ENDPOINTS: ChatGPTEndpoints = {
  issuer: 'https://auth.openai.com',
  apiBase: 'https://api.openai.com/v1'
}

/** Cifrado de secretos en reposo (safeStorage en la app; inyectable en los tests). */
export interface SecretBox {
  available(): boolean
  encrypt(plain: string): string
  decrypt(stored: string): string
}

export interface ChatGPTAccountDeps {
  dir: string
  secrets: SecretBox
  openBrowser: (url: string) => Promise<void>
  endpoints?: ChatGPTEndpoints
  onChange?: () => void
}

interface Session {
  email: string | null
  subject: string
  idToken: string
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
  scopes: string[]
}

interface StoredAuth {
  /** Cliente emitido por OpenAI en el primer registro; no es secreto. */
  clientId?: string
  /** `Session` cifrada. */
  session?: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  scope?: string
}

interface Discovery {
  issuer: string
  jwks_uri: string
  revocation_endpoint?: string
}

export interface ChatGPTModel {
  slug: string
  displayName: string
}

export function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/** Reto PKCE S256: base64url(SHA-256(verifier)) sin relleno. */
export function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

export interface AuthorizeParams {
  clientId: string | null
  hostId: string
  redirectUri: string
  state: string
  nonce: string
  challenge: string
  idTokenHint?: string
}

export function buildAuthorizeUrl(issuer: string, p: AuthorizeParams): string {
  const url = new URL('/api/accounts/authorize', issuer)
  const q = url.searchParams
  q.set('client_id', p.clientId ?? DYNAMIC_CLIENT)
  // El nombre solo se indica al registrarse por primera vez.
  if (!p.clientId) q.set('agent_name_hint', AGENT_NAME)
  q.set('ext_agent_host_id', p.hostId)
  q.set('response_type', 'code')
  q.set('redirect_uri', p.redirectUri)
  q.set('scope', SCOPES)
  q.set('resource', 'https://api.openai.com/v1')
  q.set('state', p.state)
  q.set('nonce', p.nonce)
  q.set('code_challenge_method', 'S256')
  q.set('code_challenge', p.challenge)
  if (p.idTokenHint) q.set('id_token_hint', p.idTokenHint)
  return url.toString()
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T
}

interface IdClaims {
  iss: string
  aud: string | string[]
  sub: string
  exp: number
  nonce?: string
  email?: string
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new AppErrorException('SIGN_IN_FAILED', `${res.status} ${text.slice(0, 200)}`)
  }
}

function callbackPage(ok: boolean): string {
  const msg = ok
    ? 'NoteTaker ya está conectado con ChatGPT. Puedes cerrar esta pestaña.'
    : 'No se pudo conectar NoteTaker con ChatGPT. Vuelve a la app para intentarlo de nuevo.'
  return `<!doctype html><meta charset="utf-8"><title>NoteTaker</title><body style="font:16px system-ui;padding:3rem;text-align:center">${msg}</body>`
}

/** Servidor de un solo uso en 127.0.0.1 que espera la redirección de OpenAI. */
async function startLoopback(signal: AbortSignal): Promise<{
  redirectUri: string
  callback: Promise<URLSearchParams>
  close: () => void
}> {
  let resolveCb!: (p: URLSearchParams) => void
  let rejectCb!: (e: unknown) => void
  const callback = new Promise<URLSearchParams>((res, rej) => {
    resolveCb = res
    rejectCb = rej
  })
  // Evita un "unhandled rejection" si se cierra antes de que alguien espere.
  callback.catch(() => undefined)

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end()
      return
    }
    const ok = url.searchParams.has('code') && !url.searchParams.has('error')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(callbackPage(ok))
    resolveCb(url.searchParams)
  })
  await new Promise<void>((res, rej) => {
    server.once('error', rej)
    server.listen(0, '127.0.0.1', res)
  })
  const { port } = server.address() as AddressInfo

  const timer = setTimeout(
    () => rejectCb(new AppErrorException('SIGN_IN_FAILED', 'timeout')),
    SIGN_IN_TIMEOUT_MS
  )
  const onAbort = (): void => rejectCb(new AppErrorException('CANCELLED'))
  signal.addEventListener('abort', onAbort)

  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    callback,
    close: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      server.close()
      server.closeAllConnections()
    }
  }
}

/**
 * Cuenta de ChatGPT conectada a NoteTaker. Los tokens viven cifrados en
 * `chatgpt-auth.json` y solo se usan en el proceso main.
 */
export class ChatGPTAccount {
  private readonly hostPath: string
  private readonly authPath: string
  private readonly endpoints: ChatGPTEndpoints
  private hostId: string | null = null
  private stored: StoredAuth
  private session: Session | null = null
  private refreshing: Promise<Session> | null = null
  private pending: AbortController | null = null
  private discovery: Promise<Discovery> | null = null

  constructor(private readonly deps: ChatGPTAccountDeps) {
    this.hostPath = join(deps.dir, 'chatgpt-host.json')
    this.authPath = join(deps.dir, 'chatgpt-auth.json')
    this.endpoints = deps.endpoints ?? DEFAULT_CHATGPT_ENDPOINTS
    this.stored = readJsonSync<StoredAuth>(this.authPath) ?? {}
    if (this.stored.session) {
      try {
        this.session = JSON.parse(deps.secrets.decrypt(this.stored.session)) as Session
      } catch {
        this.session = null
      }
    }
  }

  info(): ChatGPTAccountInfo | null {
    return this.session ? { email: this.session.email } : null
  }

  /** Abre el navegador para conectar la cuenta y espera la redirección. */
  async signIn(): Promise<ChatGPTAccountInfo> {
    if (!this.deps.secrets.available()) throw new AppErrorException('ENCRYPTION_UNAVAILABLE')
    this.pending?.abort()
    const controller = new AbortController()
    this.pending = controller

    const verifier = base64url(randomBytes(32))
    const state = base64url(randomBytes(16))
    const nonce = base64url(randomBytes(16))
    const loopback = await startLoopback(controller.signal)
    try {
      const authorizeUrl = buildAuthorizeUrl(this.endpoints.issuer, {
        clientId: this.stored.clientId ?? null,
        hostId: await this.getHostId(),
        redirectUri: loopback.redirectUri,
        state,
        nonce,
        challenge: pkceChallenge(verifier),
        idTokenHint: this.session?.idToken
      })
      await this.deps.openBrowser(authorizeUrl)
      const params = await loopback.callback

      if (params.get('state') !== state) throw new AppErrorException('SIGN_IN_FAILED', 'state')
      const error = params.get('error')
      if (error) {
        throw new AppErrorException(
          error === 'access_denied' ? 'ACCOUNT_NOT_ELIGIBLE' : 'SIGN_IN_FAILED',
          params.get('error_description') ?? error
        )
      }
      const code = params.get('code')
      // En una reautorización el callback puede omitir el client_id: se conserva el guardado.
      const clientId = params.get('client_id') ?? this.stored.clientId
      if (!code || !clientId || clientId === DYNAMIC_CLIENT)
        throw new AppErrorException('SIGN_IN_FAILED', 'missing code or client_id')
      this.stored.clientId = clientId

      const tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: loopback.redirectUri,
        code_verifier: verifier
      })
      const scopes = (tokens.scope ?? params.get('scope') ?? '').split(/\s+/).filter(Boolean)
      if (!scopes.includes(CHATGPT_SCOPE)) throw new AppErrorException('ACCOUNT_NOT_ELIGIBLE')
      if (!tokens.id_token || !tokens.refresh_token)
        throw new AppErrorException('SIGN_IN_FAILED', 'incomplete token response')

      const claims = await this.verifyIdToken(tokens.id_token, clientId, nonce)
      await this.saveSession({
        email: claims.email ?? null,
        subject: claims.sub,
        idToken: tokens.id_token,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        scopes
      })
      return this.info()!
    } finally {
      loopback.close()
      if (this.pending === controller) this.pending = null
    }
  }

  cancelSignIn(): void {
    this.pending?.abort()
  }

  /** Revoca el refresh token (si se puede) y borra la sesión local. */
  async signOut(): Promise<void> {
    const session = this.session
    const clientId = this.stored.clientId
    await this.clearSession()
    if (!session || !clientId) return
    try {
      const { revocation_endpoint } = await this.getDiscovery()
      if (!revocation_endpoint) return
      await fetch(revocation_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: session.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: clientId
        })
      })
    } catch {
      // La sesión local ya está borrada; si la revocación falla, el token caduca solo.
    }
  }

  /** Access token vigente; refresca (una sola vez aunque haya llamadas simultáneas) si hace falta. */
  async getAccessToken(): Promise<string> {
    const session = this.session
    if (!session) throw new AppErrorException('ACCOUNT_SIGNED_OUT')
    if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return session.accessToken
    this.refreshing ??= this.refresh(session).finally(() => (this.refreshing = null))
    return (await this.refreshing).accessToken
  }

  async listModels(): Promise<ChatGPTModel[]> {
    const token = await this.getAccessToken()
    const res = await fetch(`${this.endpoints.apiBase}/models`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status === 401) throw new AppErrorException('ACCOUNT_SIGNED_OUT')
    if (!res.ok) throw new AppErrorException('API_ERROR', `${res.status} ${await res.text()}`)
    const body = (await res.json()) as {
      models?: Array<{ slug: string; display_name?: string; visibility?: string }>
    }
    return (body.models ?? [])
      .filter((m) => m.visibility === undefined || m.visibility === 'list')
      .map((m) => ({ slug: m.slug, displayName: m.display_name ?? m.slug }))
  }

  private async refresh(session: Session): Promise<Session> {
    const clientId = this.stored.clientId
    if (!clientId) throw new AppErrorException('ACCOUNT_SIGNED_OUT')
    let tokens: TokenResponse
    try {
      tokens = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        client_id: clientId
      })
    } catch (err) {
      if (err instanceof AppErrorException && err.code === 'ACCOUNT_SIGNED_OUT') {
        await this.clearSession()
      }
      throw err
    }
    const next: Session = {
      ...session,
      accessToken: tokens.access_token,
      // Rotación: solo vale el último refresh token emitido.
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      idToken: tokens.id_token ?? session.idToken,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : session.scopes
    }
    await this.saveSession(next)
    return next
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    let res: Response
    try {
      res = await fetch(new URL('/api/accounts/oauth/token', this.endpoints.issuer), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...params, resource: 'https://api.openai.com/v1' })
      })
    } catch (err) {
      throw new AppErrorException('NETWORK', err instanceof Error ? err.message : String(err))
    }
    const body = await readJson<TokenResponse & { error?: string; error_description?: string }>(res)
    if (!res.ok || body.error) {
      const code = body.error ?? String(res.status)
      if (params.grant_type === 'refresh_token' && DEAD_REFRESH.has(code))
        throw new AppErrorException('ACCOUNT_SIGNED_OUT', code)
      throw new AppErrorException('SIGN_IN_FAILED', body.error_description ?? code)
    }
    return body
  }

  /** Firma (JWKS del emisor), `iss`, `aud`, `exp` y `nonce` del ID token. */
  private async verifyIdToken(token: string, clientId: string, nonce: string): Promise<IdClaims> {
    const [h, p, s] = token.split('.')
    if (!h || !p || !s) throw new AppErrorException('SIGN_IN_FAILED', 'id_token')
    const header = decodeJwtPart<{ alg: string; kid?: string }>(h)
    const claims = decodeJwtPart<IdClaims>(p)

    const discovery = await this.getDiscovery()
    const jwks = await readJson<{ keys: Array<JsonWebKey & { kid?: string }> }>(
      await fetch(discovery.jwks_uri)
    )
    const jwk = jwks.keys.find((k) => !header.kid || k.kid === header.kid)
    if (!jwk) throw new AppErrorException('SIGN_IN_FAILED', 'id_token key')
    const key = createPublicKey({ key: jwk, format: 'jwk' })
    const data = Buffer.from(`${h}.${p}`)
    const sig = Buffer.from(s, 'base64url')
    const valid =
      header.alg === 'RS256'
        ? verify('RSA-SHA256', data, key, sig)
        : header.alg === 'ES256'
          ? verify('SHA256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)
          : false

    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    const issuer = discovery.issuer.replace(/\/$/, '')
    if (
      !valid ||
      claims.iss.replace(/\/$/, '') !== issuer ||
      !aud.includes(clientId) ||
      claims.exp * 1000 < Date.now() ||
      claims.nonce !== nonce
    ) {
      throw new AppErrorException('SIGN_IN_FAILED', 'id_token')
    }
    return claims
  }

  private getDiscovery(): Promise<Discovery> {
    this.discovery ??= fetch(
      new URL('/.well-known/openid-configuration', this.endpoints.issuer)
    ).then((res) => readJson<Discovery>(res))
    // Si falla, no se cachea el error.
    this.discovery.catch(() => (this.discovery = null))
    return this.discovery
  }

  private async getHostId(): Promise<string> {
    if (this.hostId) return this.hostId
    const saved = readJsonSync<{ hostId?: string }>(this.hostPath)?.hostId
    this.hostId = saved ?? `urn:uuid:${randomUUID()}`
    if (!saved) await writeJsonAtomic(this.hostPath, { hostId: this.hostId })
    return this.hostId
  }

  private async saveSession(session: Session): Promise<void> {
    this.session = session
    this.stored.session = this.deps.secrets.encrypt(JSON.stringify(session))
    await writeJsonAtomic(this.authPath, this.stored)
    this.deps.onChange?.()
  }

  private async clearSession(): Promise<void> {
    const had = this.session !== null
    this.session = null
    delete this.stored.session
    await writeJsonAtomic(this.authPath, this.stored)
    if (had) this.deps.onChange?.()
  }
}

function readJsonSync<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, path)
}

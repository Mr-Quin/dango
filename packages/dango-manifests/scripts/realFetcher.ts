/**
 * A real `FetchLike` backed by Bun's global `fetch`, for the live health
 * probe. Manifests are written assuming a browser host that rewrites
 * Origin/Referer/User-Agent at the wire level (via DNR) after the request
 * leaves JS; Node/Bun impose no such restriction, so `rewriteHeaders` can be
 * merged straight into the outgoing headers here.
 *
 * Some manifests (e.g. youku) do a multi-request cookie dance where request
 * A's `Set-Cookie` must be replayed on request B. A browser host does this
 * automatically; Bun's `fetch` does not persist cookies across requests, so
 * this module keeps a small in-memory jar for the run.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FetchLike } from '@mr-quin/dango'

const here = dirname(fileURLToPath(import.meta.url))
const cookiesPath = join(here, 'health-cookies.json')

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function loadCookieMap(): Record<string, string> {
  if (!existsSync(cookiesPath)) {
    return {}
  }
  return JSON.parse(readFileSync(cookiesPath, 'utf8')) as Record<string, string>
}

const cookieMap = loadCookieMap()

interface JarCookie {
  name: string
  value: string
  /** Lowercased, no leading dot. */
  domain: string
  /** True when the cookie had no explicit `Domain` attribute (exact-host match only). */
  hostOnly: boolean
}

/** Module-level and shared across every request in one probe run, so multi-stage and cross-manifest cookie hand-offs (like youku's) work. */
const cookieJar: JarCookie[] = []

function parseSetCookie(
  setCookie: string,
  requestHost: string
): JarCookie | null {
  const parts = setCookie.split(';').map((p) => p.trim())
  const nameValue = parts[0] ?? ''
  const eqIdx = nameValue.indexOf('=')
  if (eqIdx === -1) {
    return null
  }
  const name = nameValue.slice(0, eqIdx).trim()
  const value = nameValue.slice(eqIdx + 1).trim()
  if (!name) {
    return null
  }

  let domain = requestHost
  let hostOnly = true
  for (const attr of parts.slice(1)) {
    const attrEqIdx = attr.indexOf('=')
    const attrName = (attrEqIdx === -1 ? attr : attr.slice(0, attrEqIdx))
      .trim()
      .toLowerCase()
    const attrValue = attrEqIdx === -1 ? '' : attr.slice(attrEqIdx + 1).trim()
    if (attrName === 'domain' && attrValue) {
      domain = attrValue.replace(/^\./, '').toLowerCase()
      hostOnly = false
    }
  }
  return { name, value, domain, hostOnly }
}

function storeCookie(cookie: JarCookie): void {
  const idx = cookieJar.findIndex(
    (c) => c.name === cookie.name && c.domain === cookie.domain
  )
  if (idx >= 0) {
    cookieJar[idx] = cookie
  } else {
    cookieJar.push(cookie)
  }
}

function updateJarFromResponse(res: Response, requestHost: string): void {
  // `.get('set-cookie')` collapses multiple headers into one comma-joined
  // string; `getSetCookie()` (Bun/undici) returns them un-merged instead.
  const setCookies = res.headers.getSetCookie()
  const host = (() => {
    try {
      return new URL(res.url).hostname || requestHost
    } catch {
      return requestHost
    }
  })()
  for (const setCookie of setCookies) {
    const cookie = parseSetCookie(setCookie, host)
    if (cookie) {
      storeCookie(cookie)
    }
  }
  // Bun's fetch follows redirects internally and only exposes the final
  // response, so an intermediate redirect's Set-Cookie is not captured here.
}

function jarCookiesForHost(host: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const c of cookieJar) {
    const matches = c.hostOnly
      ? c.domain === host
      : host === c.domain || host.endsWith(`.${c.domain}`)
    if (matches) {
      result[c.name] = c.value
    }
  }
  return result
}

function parseCookieHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) {
      continue
    }
    const name = part.slice(0, eqIdx).trim()
    const value = part.slice(eqIdx + 1).trim()
    if (name) {
      result[name] = value
    }
  }
  return result
}

function buildCookieHeader(hostname: string): string | undefined {
  const merged = jarCookiesForHost(hostname)
  const staticCookie = cookieMap[hostname]
  if (staticCookie) {
    // Static file cookies are set deliberately by the user; they win on collision.
    Object.assign(merged, parseCookieHeader(staticCookie))
  }
  const entries = Object.entries(merged)
  if (entries.length === 0) {
    return undefined
  }
  return entries.map(([name, value]) => `${name}=${value}`).join('; ')
}

export const realFetcher: FetchLike = async (input, init) => {
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_USER_AGENT,
    ...init?.headers,
    ...init?.rewriteHeaders,
  }

  const hostname = new URL(input).hostname
  const cookieHeader = buildCookieHeader(hostname)
  if (cookieHeader) {
    headers.Cookie = cookieHeader
  }

  const {
    rewriteHeaders: _rewriteHeaders,
    headers: _headers,
    ...rest
  } = init ?? {}
  const res = await fetch(input, { ...rest, headers })

  updateJarFromResponse(res, hostname)

  // Read the body once; text()/bytes() would otherwise race to consume the
  // same stream a second time.
  const buffer = await res.arrayBuffer()

  const responseHeaders = new Map<string, string>()
  res.headers.forEach((value, key) => {
    responseHeaders.set(key, value)
  })

  return {
    status: res.status,
    text: async () => new TextDecoder().decode(buffer),
    bytes: async () => new Uint8Array(buffer),
    headers: responseHeaders,
  }
}

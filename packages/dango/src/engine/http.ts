import { XMLParser } from 'fast-xml-parser'
import { helpers } from '../helpers/registry.js'
import {
  zDanAnyFormat,
  zResponseFormat,
  type RequestSpec,
} from '../manifest/schema.js'
import { isPrivateHost } from './host-policy.js'
import { evalExpr, evalString } from './jsonata-eval.js'
import type { ProtoRegistry } from './proto.js'
import { parseDanAnyBody } from './dan-uni.js'
import { fileParser } from '@dan-uni/dan-any/utils'

/**
 * Hard ceiling on a response body, in bytes. A request may opt into a smaller
 * cap, but never a larger one: any `maxBodyBytes` option is clamped to this.
 */
export const MAX_BODY_BYTES = 20 * 1024 * 1024

/** Default response body cap when the host does not set `maxBodyBytes`. */
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024

function resolveBodyCap(maxBodyBytes: number | undefined): number {
  if (maxBodyBytes === undefined) {
    return DEFAULT_MAX_BODY_BYTES
  }
  return Math.min(maxBodyBytes, MAX_BODY_BYTES)
}

export interface HttpResponse {
  status: number
  text: () => Promise<string>
  bytes: () => Promise<Uint8Array>
  headers: Map<string, string>
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    credentials?: 'include' | 'omit'
    signal?: AbortSignal
    /** Wire-level overrides the host applies (e.g. via chrome DNR). */
    rewriteHeaders?: Record<string, string>
  }
) => Promise<HttpResponse>

export interface HttpRunOptions {
  fetcher?: FetchLike
  /** Hosts allowlist (manifest.hosts). Resolved URLs must match. */
  allowedHosts: string[]
  /**
   * Permit requests to private/loopback hosts. Off by default: the engine
   * blocks the local network regardless of the `hosts` allowlist (anti-SSRF).
   * A host app sets this only on a deliberate, user-authorized basis (e.g. a
   * user-entered local endpoint for a trusted source). The allowlist still
   * applies; this lifts only the private-host block.
   */
  allowPrivateHosts?: boolean
  /** Cancellation signal threaded into the fetcher. */
  signal?: AbortSignal
  /** Required when any request uses `format: 'proto'`. */
  protoRegistry?: ProtoRegistry
  /**
   * Per-request response body cap, in bytes. Defaults to
   * `DEFAULT_MAX_BODY_BYTES` and is clamped to `MAX_BODY_BYTES`.
   */
  maxBodyBytes?: number
}

/**
 * Stable, localizable reason a request URL's host was rejected. The app keys
 * its own message off `code`; `HostNotAllowedError.message` is a fallback.
 */
export type HostRejectionCode = 'host-not-allowed' | 'private-host-blocked'

export class HostNotAllowedError extends Error {
  readonly code: HostRejectionCode
  /** The resolved request URL that was rejected. */
  readonly url: string
  constructor(code: HostRejectionCode, url: string) {
    super(
      code === 'private-host-blocked'
        ? `blocked private/loopback host (allowPrivateHosts not set): ${url}`
        : `URL host not in manifest.hosts allowlist: ${url}`
    )
    this.name = 'HostNotAllowedError'
    this.code = code
    this.url = url
  }
}

function allowlistMatches(host: string, allowed: string[]): boolean {
  return allowed.some((pattern) => {
    if (pattern === '*') return true
    if (pattern === host) return true
    if (pattern.startsWith('*.')) {
      return host.endsWith(pattern.slice(1))
    }
    return false
  })
}

// Returns the rejection reason, or null when the host is permitted.
// `allowPrivateHosts` lifts only the private/loopback block; the manifest's
// `hosts` allowlist still applies (so a private host needs `*` or an explicit
// entry to pass, exactly as a public host does).
function checkHost(
  url: string,
  allowed: string[],
  allowPrivateHosts: boolean
): HostRejectionCode | null {
  let host: string
  try {
    // Use `.hostname` (not `.host`) so port-suffixed URLs match bare entries.
    host = new URL(url).hostname
  } catch {
    return 'host-not-allowed'
  }
  if (isPrivateHost(host) && !allowPrivateHosts) {
    return 'private-host-blocked'
  }
  if (!allowlistMatches(host, allowed)) {
    return 'host-not-allowed'
  }
  return null
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Keep scraped text raw: never coerce numeric-looking text/attribute values
  // to JS numbers. A purely numeric danmaku comment ("666") must stay a string,
  // and large ids must not lose precision. Manifests use $number where needed.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
})

function parseTextBody(format: string, raw: string): unknown {
  switch (format) {
    case 'json':
      // 304 + acceptStatus or other empty-body cases should decode to null
      // rather than throwing on `JSON.parse('')`.
      return raw === '' ? null : JSON.parse(raw)
    case 'xml':
      return raw === '' ? null : xmlParser.parse(raw)
    case 'jsonp': {
      if (raw === '') return null
      const jsonpUnwrap = helpers.jsonpUnwrap
      if (jsonpUnwrap === undefined) {
        throw new Error('jsonpUnwrap helper missing')
      }
      return jsonpUnwrap(raw)
    }
    case 'text':
      return raw
    default:
      throw new Error(`unknown format: ${format}`)
  }
}

async function parseBodyUnion(
  spec: RequestSpec,
  raw: Uint8Array,
  context: unknown
) {
  if (zDanAnyFormat.safeParse(spec.format).success) {
    const ps = []
    for (const p of spec.dananyParams ?? []) ps.push(await evalExpr(p, context))
    return parseDanAnyBody(spec.format, raw, ps as [any, any])
  } else if (zResponseFormat.safeParse(spec.format).success)
    return parseTextBody(spec.format, await fileParser(raw, 'string'))
  else throw new Error(`unknown format: ${spec.format}`)
}

// Headers manifests can't set via `request.headers`: auth (Cookie/Auth/
// Set-Cookie) and the fetch-spec forbidden set (Origin/Referer/UA/Host ,
// silently dropped by browser fetch; manifests must use rewriteHeaders).
const FORBIDDEN_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'host',
  'origin',
  'referer',
  'user-agent',
])

async function buildHeaders(
  spec: RequestSpec,
  context: unknown
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!spec.headers) return out
  const entries = await resolveHeaderEntries(spec.headers, context)
  for (const [name, value] of entries) {
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new Error(`header "${name}" not allowed in manifest`)
    }
    out[name] = value
  }
  return out
}

async function resolveHeaderEntries(
  headers: NonNullable<RequestSpec['headers']>,
  context: unknown
): Promise<[string, string][]> {
  if (typeof headers === 'string') {
    const obj = await evalExpr(headers, context)
    if (obj === null || obj === undefined) return []
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      throw new TypeError(
        `request.headers expression must evaluate to an object, got ${Array.isArray(obj) ? 'array' : typeof obj}`
      )
    }
    const out: [string, string][] = []
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === null || v === undefined) continue
      if (typeof v !== 'string') {
        throw new TypeError(
          `request.headers["${k}"] must evaluate to a string, got ${typeof v}`
        )
      }
      out.push([k, v])
    }
    return out
  }
  const out: [string, string][] = []
  for (const [name, expr] of Object.entries(headers)) {
    out.push([name, await evalString(expr, context)])
  }
  return out
}

async function buildRewriteHeaders(
  spec: RequestSpec,
  context: unknown
): Promise<Record<string, string> | undefined> {
  if (!spec.rewriteHeaders) return undefined
  const out: Record<string, string> = {}
  for (const [name, expr] of Object.entries(spec.rewriteHeaders)) {
    out[name] = await evalString(expr, context)
  }
  return out
}

async function buildUrl(spec: RequestSpec, context: unknown): Promise<string> {
  const base = await evalString(spec.url, context)
  if (!spec.query) return base
  const queryObj = await evalExpr(spec.query, context)
  if (queryObj === null || queryObj === undefined) return base
  if (typeof queryObj !== 'object') {
    throw new TypeError(
      `request.query must evaluate to an object, got ${typeof queryObj}`
    )
  }
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(queryObj as Record<string, unknown>)) {
    if (v === null || v === undefined) continue
    params.set(k, String(v))
  }
  const qs = params.toString()
  if (!qs) return base
  return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`
}

async function buildBody(
  spec: RequestSpec,
  context: unknown
): Promise<string | undefined> {
  if (!spec.body) return undefined
  const v = await evalExpr(spec.body, context)
  if (v === null || v === undefined) return undefined
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export interface HttpStepResult {
  body: unknown
  /** Lower-cased header names (HTTP is case-insensitive). */
  headers: Record<string, string>
  status: number
}

export async function executeRequest(
  spec: RequestSpec,
  context: unknown,
  options: HttpRunOptions
): Promise<HttpStepResult> {
  const url = await buildUrl(spec, context)
  const rejection = checkHost(
    url,
    options.allowedHosts,
    options.allowPrivateHosts ?? false
  )
  if (rejection) {
    throw new HostNotAllowedError(rejection, url)
  }
  const headers = await buildHeaders(spec, context)
  const rewriteHeaders = await buildRewriteHeaders(spec, context)
  const body = await buildBody(spec, context)
  const fetcher = options.fetcher ?? defaultFetcher
  const res = await fetcher(url, {
    method: spec.method,
    headers,
    body,
    credentials: spec.credentials,
    signal: options.signal,
    rewriteHeaders,
  })
  const isOk = res.status >= 200 && res.status < 300
  const isAccepted = spec.acceptStatus.includes(res.status)
  if (!isOk && !isAccepted) {
    throw new Error(`HTTP ${res.status} for ${url}`)
  }
  const responseHeaders: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    responseHeaders[k.toLowerCase()] = v
  })
  const parsedBody = await parseBody(spec, res, context, options)
  return { body: parsedBody, headers: responseHeaders, status: res.status }
}

// UTF-16 length is a cheap lower bound on byte size, so a string whose code-unit
// count already exceeds the cap is definitely over it.
function assertWithinCap(body: Uint8Array | string, cap: number): void {
  const size = typeof body === 'string' ? body.length : body.byteLength
  if (size > cap) {
    throw new Error(`response body ${size} bytes exceeds cap of ${cap} bytes`)
  }
}

async function decompressBytes(
  bytes: Uint8Array,
  format: 'deflate' | 'deflate-raw' | 'gzip'
) {
  const blob = new Blob([bytes as BlobPart])
  const stream = blob.stream()
  const decoded = stream.pipeThrough(new DecompressionStream(format))
  return new Response(decoded).bytes()
}

async function parseBody(
  spec: RequestSpec,
  res: HttpResponse,
  context: unknown,
  options: HttpRunOptions
): Promise<unknown> {
  const cap = resolveBodyCap(options.maxBodyBytes)
  if (spec.format === 'proto') {
    // FIXME: the proto raw may be compressed, so we need to decompress first before decoding.
    if (options.protoRegistry === undefined) {
      throw new Error(
        `request specifies format: 'proto' but no protoRegistry was provided`
      )
    }
    if (spec.protoSchema === undefined || spec.protoMessage === undefined) {
      throw new Error(
        `format: 'proto' requires protoSchema and protoMessage fields`
      )
    }
    const bytes = await res.bytes()
    assertWithinCap(bytes, cap)
    return options.protoRegistry.decode(
      spec.protoSchema,
      spec.protoMessage,
      bytes
    )
  }
  if (spec.decompress) {
    const bytes = await res.bytes()
    assertWithinCap(bytes, cap)
    const dec = await decompressBytes(bytes, spec.decompress)
    assertWithinCap(dec, cap)
    return parseBodyUnion(spec, dec, context)
  }
  const bytes = await res.bytes()
  assertWithinCap(bytes, cap)
  return parseBodyUnion(spec, bytes, context)
}

const defaultFetcher: FetchLike = async (input, init) => {
  const res = await fetch(input, init as RequestInit)
  const headers = new Map<string, string>()
  res.headers.forEach((v, k) => headers.set(k, v))
  return {
    status: res.status,
    text: () => res.text(),
    bytes: async () => new Uint8Array(await res.arrayBuffer()),
    headers,
  }
}

export class AbortedError extends Error {
  constructor() {
    super('aborted')
    this.name = 'AbortedError'
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AbortedError()
  }
}

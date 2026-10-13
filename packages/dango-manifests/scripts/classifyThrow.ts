import {
  AbortedError,
  HostNotAllowedError,
  HttpStatusError,
  JsonataTimeoutError,
  NetworkError,
} from '@mr-quin/dango'

const BLOCKED_STATUSES = new Set([403, 451])
const BLOCKED_MESSAGE_PATTERN =
  /geo.?block|region.?block|not available in your (region|country)|network( is)? unreachable|enetunreach|econnrefused|econnreset|eai_again/i

export interface Diagnostics {
  name: string
  message: string
  stack?: string[]
  code?: string
  url?: string
  cause?: Diagnostics
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}…` : str
}

/** `depth` guards against a pathological (e.g. circular) `cause` chain. */
function buildDiagnostics(err: unknown, depth = 0): Diagnostics {
  if (!(err instanceof Error)) {
    return { name: typeof err, message: safeStringify(err) }
  }
  const extras = err as Error & {
    code?: unknown
    url?: unknown
    cause?: unknown
  }
  const diagnostics: Diagnostics = { name: err.name, message: err.message }
  if (err.stack) {
    diagnostics.stack = err.stack
      .split('\n')
      .slice(0, 5)
      .map((line) => line.trim())
  }
  if (extras.code !== undefined) {
    diagnostics.code = String(extras.code)
  }
  if (extras.url !== undefined) {
    diagnostics.url = String(extras.url)
  }
  if (extras.cause !== undefined && depth < 5) {
    diagnostics.cause = buildDiagnostics(extras.cause, depth + 1)
  }
  return diagnostics
}

interface ThrowClassification {
  verdict: 'broken' | 'blocked'
  note: string
  diagnostics: Diagnostics
}

export function classifyThrow(err: unknown): ThrowClassification {
  const diagnostics = buildDiagnostics(err)
  if (err instanceof HostNotAllowedError) {
    return {
      verdict: 'broken',
      note: `${err.code} for ${err.url}`,
      diagnostics,
    }
  }
  if (err instanceof JsonataTimeoutError) {
    return {
      verdict: 'broken',
      note: 'jsonata evaluation timeout',
      diagnostics,
    }
  }
  if (err instanceof AbortedError) {
    return {
      verdict: 'broken',
      note: 'request timed out',
      diagnostics,
    }
  }
  if (err instanceof HttpStatusError) {
    const note = `HTTP ${err.status} for ${err.url}`
    if (BLOCKED_STATUSES.has(err.status)) {
      return { verdict: 'blocked', note, diagnostics }
    }
    return { verdict: 'broken', note, diagnostics }
  }
  if (err instanceof NetworkError) {
    const reason = describeCause(err.cause)
    if (BLOCKED_MESSAGE_PATTERN.test(reason)) {
      return { verdict: 'blocked', note: `${reason} (${err.url})`, diagnostics }
    }
    return { verdict: 'broken', note: `${reason} (${err.url})`, diagnostics }
  }
  if (!(err instanceof Error)) {
    return {
      verdict: 'broken',
      note: `${diagnostics.name}: ${truncate(diagnostics.message, 120)}`,
      diagnostics,
    }
  }
  return {
    verdict: 'broken',
    note: `${err.constructor.name}: ${err.message}`,
    diagnostics,
  }
}

// The socket error can sit in `code` while the message stays generic, so both
// are checked.
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return String(cause)
  }
  const code = (cause as Error & { code?: unknown }).code
  return code === undefined ? cause.message : `${cause.message} (${code})`
}

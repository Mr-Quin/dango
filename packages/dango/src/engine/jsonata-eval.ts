import jsonata from 'jsonata'
import { helpers } from '../helpers/registry.js'

// `timeout` is honored by jsonata 2.x at runtime (it drives the evaluation
// guardrails) but is absent from the published `JsonataOptions` type.
type JsonataOptionsWithTimeout = NonNullable<Parameters<typeof jsonata>[1]> & {
  timeout?: number
}

function compileWithTimeout(
  expr: string,
  timeoutMs: number
): jsonata.Expression {
  const options: JsonataOptionsWithTimeout = { timeout: timeoutMs }
  return jsonata(expr, options)
}

/**
 * Per-expression evaluation budget, in milliseconds. The engine has no
 * sandbox, so an unbounded JSONata expression (a deep recursion or a wide
 * projection) can otherwise hang the host. JSONata's own guardrails poll the
 * elapsed time during evaluation and throw once it is exceeded.
 */
export const DEFAULT_EVAL_TIMEOUT_MS = 5_000

/** Default compile-cache capacity (entries). */
export const DEFAULT_MAX_CACHE_SIZE = 1_000

/**
 * JSONata evaluator with a per-instance LRU compile cache and a per-expression
 * evaluation timeout. The timeout is baked into the compiled expression's
 * guardrails, so it applies on every `evaluate` call for that expression.
 */
export class JsonataEvaluator {
  private cache = new Map<string, jsonata.Expression>()
  private readonly maxCacheSize: number
  private readonly timeoutMs: number

  constructor(opts: { maxCacheSize?: number; timeoutMs?: number } = {}) {
    this.maxCacheSize = opts.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS
  }

  private compile(expr: string): jsonata.Expression {
    const cached = this.cache.get(expr)
    if (cached !== undefined) {
      // Touch: re-insert so the most-recently-used key is newest (LRU order).
      this.cache.delete(expr)
      this.cache.set(expr, cached)
      return cached
    }
    const compiled = compileWithTimeout(expr, this.timeoutMs)
    for (const [name, fn] of Object.entries(helpers)) {
      compiled.registerFunction(name, fn as never)
    }
    if (this.cache.size >= this.maxCacheSize) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(expr, compiled)
    return compiled
  }

  async eval(expr: string, context: unknown): Promise<unknown> {
    try {
      return normalize(await this.compile(expr).evaluate(context))
    } catch (err) {
      throw rethrowTimeout(expr, err)
    }
  }

  async evalString(expr: string, context: unknown): Promise<string> {
    const v = await this.eval(expr, context)
    if (typeof v !== 'string') {
      throw new TypeError(
        `expression "${expr}" produced ${typeof v}, expected string`
      )
    }
    return v
  }

  clear(): void {
    this.cache.clear()
  }
}

// JSONata projections attach a `sequence: true` property to result arrays.
// Strip it so structural equality is stable. Copy-on-write: only allocate
// when a marker is present somewhere in the tree.
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) {
    const arr = v as unknown[] & { sequence?: unknown }
    // slice() drops the non-indexed `sequence` marker from the copy.
    const hasSequenceMarker = arr.sequence !== undefined
    let cloned: unknown[] | null = hasSequenceMarker ? arr.slice() : null
    for (let i = 0; i < arr.length; i++) {
      const inner = arr[i]
      const next = normalize(inner)
      if (next !== inner) {
        if (cloned === null) {
          cloned = arr.slice()
        }
        cloned[i] = next
      }
    }
    return cloned ?? v
  }
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    let cloned: Record<string, unknown> | null = null
    for (const k of Object.keys(obj)) {
      const inner = obj[k]
      const next = normalize(inner)
      if (next !== inner) {
        if (cloned === null) {
          cloned = { ...obj }
        }
        cloned[k] = next
      }
    }
    return cloned ?? v
  }
  return v
}

/** Raised when an expression exceeds the evaluator's per-expression timeout. */
export class JsonataTimeoutError extends Error {
  constructor(expr: string) {
    super(`expression "${expr}" exceeded the evaluation timeout`)
    this.name = 'JsonataTimeoutError'
  }
}

// JSONata signals a guardrail trip by throwing a plain object carrying
// `code: 'D1012'`, not an Error instance. Translate it into a typed error and
// pass anything else through untouched.
function rethrowTimeout(expr: string, err: unknown): unknown {
  if (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: unknown }).code === 'D1012'
  ) {
    return new JsonataTimeoutError(expr)
  }
  return err
}

export const defaultEvaluator = new JsonataEvaluator()

export function evalExpr(expr: string, context: unknown): Promise<unknown> {
  return defaultEvaluator.eval(expr, context)
}

export function evalString(expr: string, context: unknown): Promise<string> {
  return defaultEvaluator.evalString(expr, context)
}

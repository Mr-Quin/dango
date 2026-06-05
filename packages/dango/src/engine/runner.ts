import type {
  Manifest,
  Pipeline,
  Step,
  VariantPipeline,
} from '../manifest/schema.js'
import {
  AbortedError,
  executeRequest,
  type FetchLike,
  throwIfAborted,
} from './http.js'
import { evalExpr } from './jsonata-eval.js'
import type { ProtoRegistry } from './proto.js'

export type Context = Record<string, unknown>

/** One cached http-step extract bag plus its wall-clock expiry (ms epoch). */
export interface HttpCacheEntry {
  expiresAt: number
  value: unknown
}

/**
 * Keyed store for `cache`-enabled http steps. `ManifestRunner` owns one per
 * instance and threads it in; entries survive across runs of that runner.
 */
export type HttpStepCache = Map<string, HttpCacheEntry>

export interface RunOptions {
  fetcher?: FetchLike
  /** Cancel the pipeline. Checked between steps and threaded into fetch. */
  signal?: AbortSignal
  /**
   * Required if any pipeline step uses `format: 'proto'`. `ManifestRunner`
   * constructs one automatically.
   */
  protoRegistry?: ProtoRegistry
  /**
   * Backing store for http steps that declare `cache`. `ManifestRunner`
   * provides an instance-level Map; omit it to disable caching (every
   * cache-enabled step then fetches normally).
   */
  httpCache?: HttpStepCache
  /**
   * Per-`forEach` input length cap. Defaults to `DEFAULT_MAX_FOR_EACH_ITEMS`
   * and is clamped to the hard `MAX_FOR_EACH_ITEMS`.
   */
  maxForEachItems?: number
  /**
   * Per-request response body cap, in bytes. Threaded into each http request;
   * defaults to the http module's default and is clamped to its hard max.
   */
  maxBodyBytes?: number
}

/** Hard ceiling on the elements a `forEach.in` array may yield. */
export const MAX_FOR_EACH_ITEMS = 10_000

/** Default `forEach.in` length cap when the host does not set one. */
export const DEFAULT_MAX_FOR_EACH_ITEMS = 1_000

function resolveForEachCap(maxForEachItems: number | undefined): number {
  if (maxForEachItems === undefined) {
    return DEFAULT_MAX_FOR_EACH_ITEMS
  }
  return Math.min(maxForEachItems, MAX_FOR_EACH_ITEMS)
}

async function runHttpExtract(
  result: { body: unknown; headers: Record<string, string> },
  extract: Record<string, string> | undefined,
  extractHeaders: Record<string, string> | undefined
): Promise<unknown> {
  if (!extract && !extractHeaders) {
    return result.body
  }
  const bag: Record<string, unknown> = {}
  if (extract) {
    for (const [name, expr] of Object.entries(extract)) {
      bag[name] = await evalExpr(expr, result.body)
    }
  }
  if (extractHeaders) {
    for (const [name, expr] of Object.entries(extractHeaders)) {
      bag[name] = await evalExpr(expr, result.headers)
    }
  }
  return bag
}

/**
 * Returns a `waitForSlot` closure that enforces `throttleMs` between
 * consecutive request starts. Reserves the slot synchronously so concurrent
 * callers don't both observe the same `earliestStart` and fire at the same
 * instant. Throws AbortedError if the signal aborts while waiting.
 */
function makeThrottle(
  throttleMs: number,
  signal: AbortSignal | undefined
): () => Promise<void> {
  let earliestStart = 0
  return async () => {
    if (throttleMs <= 0) return
    const slotStart = Math.max(earliestStart, Date.now())
    earliestStart = slotStart + throttleMs
    const delay = slotStart - Date.now()
    if (delay <= 0) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, delay)
      const onAbort = () => {
        clearTimeout(timer)
        reject(new AbortedError())
      }
      if (signal?.aborted) {
        clearTimeout(timer)
        reject(new AbortedError())
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  throttleMs: number,
  signal: AbortSignal | undefined,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const waitForSlot = makeThrottle(throttleMs, signal)

  if (limit <= 1 || items.length <= 1) {
    const out: R[] = []
    for (const item of items) {
      await waitForSlot()
      out.push(await task(item))
    }
    return out
  }
  const results: R[] = []
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        await waitForSlot()
        results[i] = await task(items[i] as T)
      }
    }
  )
  await Promise.all(workers)
  return results
}

async function runStep(
  step: Step,
  context: Context,
  manifest: Manifest,
  options: RunOptions
): Promise<void> {
  throwIfAborted(options.signal)

  if (step.type === 'assign') {
    const bag: Record<string, unknown> = {}
    for (const [name, expr] of Object.entries(step.values)) {
      bag[name] = await evalExpr(expr, context)
    }
    context[step.id] = bag
    return
  }

  if (step.type === 'forEach') {
    const items = await evalExpr(step.in, context)
    if (!Array.isArray(items)) {
      throw new TypeError(
        `forEach.in must evaluate to an array, got ${typeof items}`
      )
    }
    const forEachCap = resolveForEachCap(options.maxForEachItems)
    if (items.length > forEachCap) {
      throw new Error(
        `forEach.in yielded ${items.length} items, exceeding cap of ${forEachCap}`
      )
    }
    const runIteration = async (element: unknown) => {
      throwIfAborted(options.signal)
      const iterContext: Context = { ...context, [step.as]: element }
      const result = await executeRequest(step.request, iterContext, {
        fetcher: options.fetcher,
        allowedHosts: manifest.hosts,
        signal: options.signal,
        protoRegistry: options.protoRegistry,
        maxBodyBytes: options.maxBodyBytes,
      })
      const extracted = await runHttpExtract(result, step.extract, undefined)
      if (!step.collect) {
        return extracted
      }
      return evalExpr(step.collect, extracted)
    }
    let perItemResults: unknown[]
    if (step.breakOn) {
      // Sequential. Current result is included before the stop check;
      // breakOnConsecutive requires N back-to-back truthy to stop.
      perItemResults = []
      const stopExpr = step.breakOn
      const threshold = step.breakOnConsecutive
      const waitForSlot = makeThrottle(step.throttleMs, options.signal)
      let consecutive = 0
      for (const element of items) {
        await waitForSlot()
        const result = await runIteration(element)
        perItemResults.push(result)
        const stop = await evalExpr(stopExpr, result)
        if (stop) {
          consecutive += 1
          if (consecutive >= threshold) break
        } else {
          consecutive = 0
        }
      }
    } else {
      perItemResults = await runWithConcurrency(
        items,
        step.concurrency,
        step.throttleMs,
        options.signal,
        runIteration
      )
    }
    /** Flat-concat per-iteration arrays; non-array values contribute themselves. */
    const flat: unknown[] = []
    for (const r of perItemResults) {
      if (Array.isArray(r)) {
        for (const item of r) flat.push(item)
      } else if (r !== null && r !== undefined) {
        flat.push(r)
      }
    }
    context[step.id] = flat
    return
  }

  // http. The schema refine guarantees `id` whenever `cache` is set.
  if (step.cache && options.httpCache) {
    const cached = options.httpCache.get(step.cache.key)
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      context[step.id as string] = cached.value
      return
    }
  }

  const result = await executeRequest(step.request, context, {
    fetcher: options.fetcher,
    allowedHosts: manifest.hosts,
    signal: options.signal,
    protoRegistry: options.protoRegistry,
    maxBodyBytes: options.maxBodyBytes,
  })
  if (!step.id) {
    return
  }
  const extracted = await runHttpExtract(
    result,
    step.extract,
    step.extractHeaders
  )
  context[step.id] = extracted

  if (step.cache && options.httpCache) {
    options.httpCache.set(step.cache.key, {
      expiresAt: Date.now() + step.cache.ttlSeconds * 1000,
      value: extracted,
    })
  }
}

/** After parse, every Manifest pipeline field is normalized to this shape. */
export type PipelineInput = VariantPipeline[]

async function selectVariant(
  variants: VariantPipeline[],
  context: Context
): Promise<VariantPipeline> {
  // First matching `when` wins. A variant without `when` is the fallback,
  // used only if no conditional matched, placement in the array is irrelevant.
  let fallback: VariantPipeline | undefined
  for (const v of variants) {
    if (v.when === undefined) {
      if (fallback === undefined) fallback = v
      continue
    }
    if (await evalExpr(v.when, context)) return v
  }
  if (fallback !== undefined) return fallback
  throw new Error('no pipeline variant matched (and no unconditional default)')
}

export async function runPipeline(
  manifest: Manifest,
  variants: PipelineInput,
  inputs: Record<string, unknown>,
  options: RunOptions = {}
): Promise<unknown> {
  const initialContext: Context = { ...inputs }
  const pipeline: Pipeline = await selectVariant(variants, initialContext)
  for (const required of pipeline.inputs) {
    if (!(required in inputs)) {
      throw new Error(`missing required input: ${required}`)
    }
  }
  const context: Context = { ...inputs }
  for (const step of pipeline.steps) {
    throwIfAborted(options.signal)
    await runStep(step, context, manifest, options)
  }
  throwIfAborted(options.signal)
  const output = await evalExpr(pipeline.output, context)
  if (pipeline.map === undefined) {
    return output
  }
  return mapRows(pipeline.map, output, options.signal)
}

/** Applies the per-row `map` expression to each element of `output`, checking aborts periodically. */
async function mapRows(
  expr: string,
  output: unknown,
  signal: AbortSignal | undefined
): Promise<unknown[]> {
  if (!Array.isArray(output)) {
    throw new TypeError(
      `map requires the pipeline output to be an array, got ${typeof output}`
    )
  }
  const result: unknown[] = []
  for (let i = 0; i < output.length; i++) {
    if (i % 1024 === 0) {
      throwIfAborted(signal)
    }
    result.push(await evalExpr(expr, output[i]))
  }
  return result
}

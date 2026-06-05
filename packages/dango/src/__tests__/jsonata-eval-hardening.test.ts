import { describe, expect, it } from 'bun:test'
import {
  JsonataEvaluator,
  JsonataTimeoutError,
} from '../engine/jsonata-eval.js'

/**
 * JSONata evaluator hardening: a per-expression evaluation timeout that
 * interrupts a runaway expression, and an LRU compile cache that evicts the
 * least-recently-used entry rather than the oldest-inserted one. Both close
 * resource-exhaustion footguns for untrusted manifests.
 */

describe('per-expression evaluation timeout', () => {
  it('throws JsonataTimeoutError on a runaway expression', async () => {
    const ev = new JsonataEvaluator({ timeoutMs: 50 })
    const runaway =
      '( $f := function($n){ $n <= 0 ? 0 : $f($n - 1) + 1 }; [1..100000].($f(900)) )'
    await expect(ev.eval(runaway, {})).rejects.toBeInstanceOf(
      JsonataTimeoutError
    )
  })

  it('completes a normal expression that finishes within the budget', async () => {
    const ev = new JsonataEvaluator({ timeoutMs: 5000 })
    const result = await ev.eval('items[value > 0].value', {
      items: [{ value: 1 }, { value: 0 }, { value: 2 }],
    })
    expect(result).toEqual([1, 2])
  })

  it('does not translate unrelated evaluation errors into timeouts', async () => {
    const ev = new JsonataEvaluator({ timeoutMs: 5000 })
    // String-typed evalString against a number result surfaces a TypeError,
    // not a timeout.
    await expect(ev.evalString('1 + 1', {})).rejects.toBeInstanceOf(TypeError)
  })
})

describe('LRU compile cache', () => {
  it('evicts the least-recently-used entry, not the oldest-inserted', async () => {
    const ev = new JsonataEvaluator({ maxCacheSize: 2 })
    // Insert A then B (cache: [A, B]).
    await ev.eval("'A'", {})
    await ev.eval("'B'", {})
    // Touch A so it becomes most-recently-used (cache order: [B, A]).
    await ev.eval("'A'", {})
    // Insert C: capacity is 2, so the LRU entry (B) is evicted, not A.
    await ev.eval("'C'", {})

    expect(cacheKeys(ev)).toEqual(["'A'", "'C'"])
  })

  it('bounds the cache at maxCacheSize', async () => {
    const ev = new JsonataEvaluator({ maxCacheSize: 3 })
    for (let i = 0; i < 10; i++) {
      await ev.eval(`${i} + 0`, {})
    }
    expect(cacheKeys(ev).length).toBe(3)
  })
})

function cacheKeys(ev: JsonataEvaluator): string[] {
  const cache = (ev as unknown as { cache: Map<string, unknown> }).cache
  return [...cache.keys()]
}

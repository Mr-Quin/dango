import { describe, expect, it } from 'bun:test'
import { ManifestRunner } from '../engine/ManifestRunner.js'
import type { FetchLike } from '../engine/http.js'
import { runPipeline } from '../engine/runner.js'
import { zManifest } from '../manifest/schema.js'

/**
 * forEach fails fast by default (cancel siblings, reject); the `continueOnError`
 * RunOption tolerates per-iteration failures and returns partial results.
 */

function manifest(forEach: Record<string, unknown>) {
  return zManifest.parse({
    apiVersion: 1,
    identityFields: [],
    id: 'foreach-err',
    name: 'foreach-err',
    version: '0.1.0',
    hosts: ['api.example.com'],
    search: {
      inputs: ['q'],
      steps: [
        {
          type: 'forEach',
          id: 'loop',
          in: '$range(0, 7)',
          as: 'i',
          request: {
            method: 'GET',
            url: "'https://api.example.com/x?i=' & $string(i)",
          },
          ...forEach,
        },
      ],
      output: 'loop',
    },
  })
}

function fail(): ReturnType<FetchLike> {
  return Promise.resolve({
    status: 500,
    text: async () => '{}',
    bytes: async () => new Uint8Array(),
    headers: new Map(),
  })
}

function ok(body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    status: 200,
    text: async () => JSON.stringify(body),
    bytes: async () => new Uint8Array(),
    headers: new Map(),
  })
}

describe('forEach default error handling (fail-fast)', () => {
  it('cancels in-flight sibling requests when one iteration fails', async () => {
    let siblingAborted = false
    const fetcher: FetchLike = async (url, init) => {
      if (url.endsWith('i=0')) return fail()
      // Hang until aborted, so settling proves cancellation.
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            siblingAborted = true
            reject(new Error('aborted'))
          },
          { once: true }
        )
      })
    }

    const m = manifest({ concurrency: 2 })
    await expect(
      runPipeline(m, m.search!, { q: 'x' }, { fetcher })
    ).rejects.toThrow(/HTTP 500/)
    expect(siblingAborted).toBe(true)
  })

  it('rejects the step (does not tolerate) without the option', async () => {
    const fetcher: FetchLike = async (url) =>
      url.endsWith('i=3') ? fail() : ok({ items: [] })

    const m = manifest({ concurrency: 2, collect: 'items' })
    await expect(
      runPipeline(m, m.search!, { q: 'x' }, { fetcher })
    ).rejects.toThrow(/HTTP 500/)
  })
})

describe('forEach continueOnError (host RunOption)', () => {
  it('skips failed iterations, runs them all, and returns partial results', async () => {
    const dispatched: string[] = []
    const fetcher: FetchLike = async (url) => {
      dispatched.push(url)
      const i = Number(url.split('i=')[1])
      return i === 1 || i === 4 ? fail() : ok({ items: [i] })
    }

    const m = manifest({ concurrency: 2, collect: 'items' })
    const out = await runPipeline(
      m,
      m.search!,
      { q: 'x' },
      {
        fetcher,
        continueOnError: true,
      }
    )

    expect(dispatched).toHaveLength(7)
    expect(out).toEqual([0, 2, 3, 5, 6])
  })

  it('still propagates a genuine external abort', async () => {
    const controller = new AbortController()
    const fetcher: FetchLike = async (url) => {
      if (url.endsWith('i=0')) controller.abort()
      return ok({ items: [] })
    }

    const m = manifest({ concurrency: 2, collect: 'items', throttleMs: 5000 })
    await expect(
      runPipeline(
        m,
        m.search!,
        { q: 'x' },
        {
          fetcher,
          signal: controller.signal,
          continueOnError: true,
        }
      )
    ).rejects.toThrow(/aborted/i)
  })

  it('threads through the ManifestRunner public API', async () => {
    const fetcher: FetchLike = async (url) => {
      const i = Number(url.split('i=')[1])
      return i === 2 ? fail() : ok({ items: [i] })
    }

    const runner = new ManifestRunner(
      manifest({ concurrency: 2, collect: 'items' }),
      { fetcher }
    )
    const out = await runner.runSearch({ q: 'x' }, { continueOnError: true })

    expect(out).toEqual([0, 1, 3, 4, 5, 6])
  })
})

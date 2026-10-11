import { describe, expect, it } from 'bun:test'
import { MAX_BODY_BYTES } from '../engine/http.js'
import {
  MAX_FOR_EACH_ITEMS,
  type RunOptions,
  runPipeline,
} from '../engine/runner.js'
import { zManifest } from '../manifest/schema.js'
import { mockFetcher } from './fixtures.js'

/**
 * Two-tier caps for response body size and forEach input length: a permissive
 * default that the host may raise, clamped to a fixed hard ceiling it cannot
 * exceed. Asserts the default rejects, an opt-in raise allows up to the hard
 * cap, and the clamp blocks anything past it.
 */

function baseManifest(overrides: Record<string, unknown>) {
  return zManifest.parse({
    apiVersion: 1,
    id: 'test',
    name: 'test',
    version: '0.1.0',
    hosts: ['api.example.com'],
    ...overrides,
  })
}

function bodyManifest() {
  return baseManifest({
    search: {
      inputs: [],
      steps: [
        {
          type: 'http',
          id: 'r',
          request: { method: 'GET', url: "'https://api.example.com/x'" },
          extract: { v: 'ok' },
        },
      ],
      output: 'r.v',
    },
  })
}

function run(
  manifest: ReturnType<typeof baseManifest>,
  fetcher: RunOptions['fetcher'],
  opts: Partial<RunOptions> = {}
) {
  return runPipeline(manifest, manifest.search!, {}, { fetcher, ...opts })
}

describe('response body size: default vs hard cap', () => {
  it('rejects a body over the ~5MB default cap', async () => {
    const manifest = bodyManifest()
    const big = `{"ok":"${'a'.repeat(6 * 1024 * 1024)}"}`
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body: big },
    })
    await expect(run(manifest, fetcher)).rejects.toThrow(/exceeds cap/)
  })

  it('allows the same body when the host raises maxBodyBytes', async () => {
    const manifest = bodyManifest()
    const body = `{"ok":${JSON.stringify('a'.repeat(6 * 1024 * 1024))}}`
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body },
    })
    await expect(
      run(manifest, fetcher, { maxBodyBytes: 10 * 1024 * 1024 })
    ).resolves.toBe('a'.repeat(6 * 1024 * 1024))
  })

  it('clamps maxBodyBytes to the hard ceiling', async () => {
    const manifest = bodyManifest()
    const big = `{"ok":"${'a'.repeat(MAX_BODY_BYTES + 1024)}"}`
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body: big },
    })
    await expect(
      run(manifest, fetcher, { maxBodyBytes: Number.MAX_SAFE_INTEGER })
    ).rejects.toThrow(/exceeds cap/)
  })
})

describe('forEach.in length: default vs hard cap', () => {
  function forEachManifest() {
    return baseManifest({
      search: {
        inputs: ['items'],
        steps: [
          {
            type: 'forEach',
            id: 'loop',
            in: 'items',
            as: 'i',
            request: { method: 'GET', url: "'https://api.example.com/x'" },
          },
        ],
        output: 'loop',
      },
    })
  }

  function runForEach(
    manifest: ReturnType<typeof baseManifest>,
    items: number[],
    opts: Partial<RunOptions> = {}
  ) {
    const { fetcher, calls } = mockFetcher({
      'https://api.example.com/x': { body: '{}' },
    })
    const result = runPipeline(
      manifest,
      manifest.search!,
      { items },
      { fetcher, ...opts }
    )
    return { result, calls }
  }

  it('rejects an array over the ~1000 default cap', async () => {
    const items = Array.from({ length: 1001 }, (_, i) => i)
    const { result } = runForEach(forEachManifest(), items)
    await expect(result).rejects.toThrow(/exceeding cap/)
  })

  it('allows it when the host raises maxForEachItems', async () => {
    const items = Array.from({ length: 1001 }, (_, i) => i)
    const { result, calls } = runForEach(forEachManifest(), items, {
      maxForEachItems: 2000,
    })
    await result
    expect(calls).toHaveLength(1001)
  })

  it('clamps maxForEachItems to the hard ceiling', async () => {
    const items = Array.from({ length: MAX_FOR_EACH_ITEMS + 1 }, (_, i) => i)
    const { result } = runForEach(forEachManifest(), items, {
      maxForEachItems: Number.MAX_SAFE_INTEGER,
    })
    await expect(result).rejects.toThrow(/exceeding cap/)
  })
})

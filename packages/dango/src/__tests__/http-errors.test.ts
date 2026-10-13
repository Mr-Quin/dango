import { describe, expect, it } from 'bun:test'
import {
  AbortedError,
  type FetchLike,
  HostNotAllowedError,
  HttpStatusError,
  NetworkError,
  runPipeline,
  zManifest,
} from '../index.js'

const TARGET = 'https://api.example.com/x'

function manifest(acceptStatus?: number[]) {
  return zManifest.parse({
    apiVersion: 1,
    id: 'http-errors',
    name: 'http-errors',
    version: '0.1.0',
    hosts: ['api.example.com'],
    search: {
      inputs: [],
      steps: [
        {
          type: 'http',
          id: 'r',
          request: { method: 'GET', url: `'${TARGET}'`, acceptStatus },
        },
      ],
      output: 'r',
    },
  })
}

function respond(status: number): ReturnType<FetchLike> {
  return Promise.resolve({
    status,
    text: async () => '{}',
    bytes: async () => new Uint8Array(),
    headers: new Map(),
  })
}

async function run(fetcher: FetchLike, signal?: AbortSignal) {
  const m = manifest()
  return runPipeline(m, m.search!, {}, { fetcher, signal }).catch(
    (e: unknown) => e
  )
}

describe('HttpStatusError', () => {
  it('carries the status and resolved url of a non-2xx response', async () => {
    const err = await run(() => respond(503))
    expect(err).toBeInstanceOf(HttpStatusError)
    if (err instanceof HttpStatusError) {
      expect(err.code).toBe('http-status')
      expect(err.status).toBe(503)
      expect(err.url).toBe(TARGET)
      expect(err.message).toBe(`HTTP 503 for ${TARGET}`)
    }
  })

  it('is not raised for a status listed in acceptStatus', async () => {
    const m = manifest([404])
    const out = await runPipeline(
      m,
      m.search!,
      {},
      { fetcher: () => respond(404) }
    )
    expect(out).toEqual({})
  })
})

describe('NetworkError', () => {
  it('wraps a fetcher rejection and keeps it as cause', async () => {
    const original = new TypeError('Failed to fetch')
    const err = await run(() => Promise.reject(original))
    expect(err).toBeInstanceOf(NetworkError)
    if (err instanceof NetworkError) {
      expect(err.code).toBe('network')
      expect(err.url).toBe(TARGET)
      expect(err.cause).toBe(original)
    }
  })

  it('wraps a fetcher that throws synchronously', async () => {
    const original = new Error('boom')
    const fetcher: FetchLike = () => {
      throw original
    }
    const err = await run(fetcher)
    expect(err).toBeInstanceOf(NetworkError)
    expect((err as NetworkError).cause).toBe(original)
  })

  it('is not raised for a host the allowlist rejects', async () => {
    let called = false
    const m = zManifest.parse({
      ...manifest(),
      hosts: ['other.example.com'],
    })
    const err = await runPipeline(
      m,
      m.search!,
      {},
      {
        fetcher: () => {
          called = true
          return respond(200)
        },
      }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HostNotAllowedError)
    expect(called).toBe(false)
  })
})

describe('aborted requests', () => {
  it('raise AbortedError when the fetcher rejects after the signal aborts', async () => {
    const controller = new AbortController()
    const fetcher: FetchLike = () => {
      controller.abort()
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    }
    const err = await run(fetcher, controller.signal)
    expect(err).toBeInstanceOf(AbortedError)
    expect(err).not.toBeInstanceOf(NetworkError)
  })

  it('pass through an AbortedError the fetcher throws itself', async () => {
    const err = await run(() => Promise.reject(new AbortedError()))
    expect(err).toBeInstanceOf(AbortedError)
  })
})

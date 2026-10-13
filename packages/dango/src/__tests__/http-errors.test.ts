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
    const reason = new DOMException('signal timed out', 'TimeoutError')
    const fetcher: FetchLike = () => {
      controller.abort(reason)
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    }
    const err = await run(fetcher, controller.signal)
    expect(err).toBeInstanceOf(AbortedError)
    expect(err).not.toBeInstanceOf(NetworkError)
    expect((err as AbortedError).cause).toBe(reason)
  })

  it('pass through an AbortedError the fetcher throws itself', async () => {
    const err = await run(() => Promise.reject(new AbortedError()))
    expect(err).toBeInstanceOf(AbortedError)
  })
})

function respondWithBody(read: () => Promise<string>): ReturnType<FetchLike> {
  return Promise.resolve({
    status: 200,
    text: read,
    bytes: async () => new TextEncoder().encode(await read()),
    headers: new Map(),
  })
}

describe('body read failures', () => {
  it('raise NetworkError when the body stream breaks', async () => {
    const reset = new TypeError('network connection was lost')
    const err = await run(() => respondWithBody(() => Promise.reject(reset)))
    expect(err).toBeInstanceOf(NetworkError)
    expect((err as NetworkError).cause).toBe(reset)
    expect((err as NetworkError).url).toBe(TARGET)
  })

  it('raise AbortedError when the signal aborts mid-body', async () => {
    const controller = new AbortController()
    const err = await run(
      () =>
        respondWithBody(() => {
          controller.abort()
          return Promise.reject(new DOMException('aborted', 'AbortError'))
        }),
      controller.signal
    )
    expect(err).toBeInstanceOf(AbortedError)
  })

  it('do not report a body that fails to decompress as a network failure', async () => {
    const m = zManifest.parse({
      ...manifest(),
      search: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'r',
            request: { method: 'GET', url: `'${TARGET}'`, decompress: 'gzip' },
          },
        ],
        output: 'r',
      },
    })
    const err = await runPipeline(
      m,
      m.search!,
      {},
      { fetcher: () => respondWithBody(async () => 'not gzip') }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(NetworkError)
  })
})

describe('forEach with continueOnError', () => {
  function loopManifest() {
    return zManifest.parse({
      apiVersion: 1,
      id: 'loop',
      name: 'loop',
      version: '0.1.0',
      hosts: ['api.example.com'],
      search: {
        inputs: [],
        steps: [
          {
            type: 'forEach',
            id: 'loop',
            in: '$range(0, 3)',
            as: 'i',
            request: {
              method: 'GET',
              url: "'https://api.example.com/x?i=' & $string(i)",
            },
          },
        ],
        output: 'loop',
      },
    })
  }

  it('skips an iteration whose body read failed', async () => {
    const m = loopManifest()
    const fetcher: FetchLike = (url) =>
      url.endsWith('i=1')
        ? respondWithBody(() => Promise.reject(new TypeError('reset')))
        : respondWithBody(async () => '[1]')
    const out = await runPipeline(
      m,
      m.search!,
      {},
      { fetcher, continueOnError: true }
    )
    expect(out).toHaveLength(2)
  })

  it('propagates an abort that lands during a body read', async () => {
    const m = loopManifest()
    const controller = new AbortController()
    const fetcher: FetchLike = () =>
      respondWithBody(() => {
        controller.abort()
        return Promise.reject(new DOMException('aborted', 'AbortError'))
      })
    const err = await runPipeline(
      m,
      m.search!,
      {},
      { fetcher, continueOnError: true, signal: controller.signal }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AbortedError)
  })
})

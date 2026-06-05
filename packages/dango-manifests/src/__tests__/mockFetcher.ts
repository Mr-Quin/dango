import type { FetchLike } from '@mr-quin/dango'

export interface MockResponse {
  status?: number
  body: string | Uint8Array
  headers?: Record<string, string>
}

export type MockHandler =
  | MockResponse
  | ((url: string, init: unknown) => MockResponse)

/**
 * Test fetcher for fixture-backed pipeline tests. Handlers are keyed by exact
 * URL, falling back to the URL with its query string stripped. Bodies may be a
 * string or Uint8Array (the latter for `format: 'proto'`); both `text()` and
 * `bytes()` convert as needed. Records every call for assertions.
 */
export function mockFetcher(handlers: Record<string, MockHandler>): {
  fetcher: FetchLike
  calls: { url: string; init?: unknown }[]
} {
  const calls: { url: string; init?: unknown }[] = []
  const fetcher: FetchLike = async (input, init) => {
    calls.push({ url: input, init })
    let handler = handlers[input]
    if (handler === undefined) {
      const noQuery = input.split('?')[0]
      handler = handlers[noQuery]
    }
    if (handler === undefined) {
      throw new Error(`mockFetcher: no handler for ${input}`)
    }
    const resp = typeof handler === 'function' ? handler(input, init) : handler
    const headers = new Map<string, string>(Object.entries(resp.headers ?? {}))
    const isBytes = resp.body instanceof Uint8Array
    return {
      status: resp.status ?? 200,
      text: async () => {
        return isBytes
          ? new TextDecoder().decode(resp.body as Uint8Array)
          : (resp.body as string)
      },
      bytes: async () => {
        return isBytes
          ? (resp.body as Uint8Array)
          : new TextEncoder().encode(resp.body as string)
      },
      headers,
    }
  }
  return { fetcher, calls }
}
